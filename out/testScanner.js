"use strict";
// testScanner.ts
// Pure AutoIt "test block" scanner used by the Test Explorer integration.
// No vscode dependency, so it can be unit-tested in isolation.
//
// A "test" is a top-level (depth-0) `With test("<name>") ... EndWith` block in a script.
// Nested `With teststep(...) ... EndWith` blocks are counted for depth but are NOT tests.
// The scanner is comment/string aware so `With`/`EndWith`/`test(` appearing inside a line
// comment, a #cs/#ce block, or a string literal cannot throw off the depth counting.
Object.defineProperty(exports, "__esModule", { value: true });
exports.findTests = findTests;
exports.buildSingleTestScript = buildSingleTestScript;
// Return the code portion of a line with any trailing `;` comment removed, respecting
// single/double quoted strings. AutoIt escapes a quote by doubling it inside the string.
function stripLineComment(line) {
    let inString = false;
    let quote = '';
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inString) {
            if (c === quote) {
                if (line[i + 1] === quote) {
                    i++;
                    continue;
                } // doubled quote = literal, stay in string
                inString = false;
                quote = '';
            }
        }
        else if (c === '"' || c === "'") {
            inString = true;
            quote = c;
        }
        else if (c === ';') {
            return line.slice(0, i);
        }
    }
    return line;
}
function splitLines(text) {
    return text.split(/\r\n|\r|\n/);
}
// Find every top-level `With test("...")` block and its matching `EndWith`.
function findTests(text) {
    const lines = splitLines(text);
    const blocks = [];
    let depth = 0;
    let inBlockComment = false;
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const code = stripLineComment(lines[i]).trim();
        // #cs / #comments-start ... #ce / #comments-end
        if (!inBlockComment && /^#(cs|comments-start)\b/i.test(code)) {
            inBlockComment = true;
            continue;
        }
        if (inBlockComment) {
            if (/^#(ce|comments-end)\b/i.test(code)) {
                inBlockComment = false;
            }
            continue;
        }
        if (code === '') {
            continue;
        }
        if (/^With\b/i.test(code)) {
            if (depth === 0) {
                // A top-level `With test("name")` starts a test block.
                const m = code.match(/^With\s+test\s*\(\s*(["'])([\s\S]*?)\1/i);
                if (m) {
                    current = { name: m[2], startLine: i };
                }
            }
            depth++;
        }
        else if (/^EndWith\b/i.test(code)) {
            depth--;
            if (depth <= 0) {
                depth = 0;
                if (current) {
                    blocks.push({ name: current.name, startLine: current.startLine, endLine: i });
                    current = null;
                }
            }
        }
    }
    return blocks;
}
// Line indices of standalone top-level `Exit` statements — i.e. a line whose code begins with
// `Exit` while NOT inside any Func...EndFunc or With...EndWith block. These are developer
// "short-circuit" exits (stop a full run after a few tests); keeping one would abort a single-test
// run before it reaches the selected block. Conditional exits (`If ... Then Exit`) are not matched
// (the line starts with `If`), `ExitLoop` is not matched (\b after `Exit` fails before `Loop`),
// and Exits inside functions or inside the kept test block are preserved.
function findTopLevelExitLines(text) {
    const lines = splitLines(text);
    const result = [];
    let withDepth = 0;
    let funcDepth = 0;
    let inBlockComment = false;
    for (let i = 0; i < lines.length; i++) {
        const code = stripLineComment(lines[i]).trim();
        if (!inBlockComment && /^#(cs|comments-start)\b/i.test(code)) {
            inBlockComment = true;
            continue;
        }
        if (inBlockComment) {
            if (/^#(ce|comments-end)\b/i.test(code)) {
                inBlockComment = false;
            }
            continue;
        }
        if (code === '') {
            continue;
        }
        if (funcDepth === 0 && withDepth === 0 && /^Exit\b/i.test(code)) {
            result.push(i);
        }
        if (/^Func\b/i.test(code)) {
            funcDepth++;
        }
        else if (/^EndFunc\b/i.test(code)) {
            funcDepth = Math.max(0, funcDepth - 1);
        }
        else if (/^With\b/i.test(code)) {
            withDepth++;
        }
        else if (/^EndWith\b/i.test(code)) {
            withDepth = Math.max(0, withDepth - 1);
        }
    }
    return result;
}
// Ranges of every top-level Func...EndFunc definition (AutoIt functions don't nest).
function findFuncRanges(text) {
    const lines = splitLines(text);
    const ranges = [];
    let inBlockComment = false;
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        const code = stripLineComment(lines[i]).trim();
        if (!inBlockComment && /^#(cs|comments-start)\b/i.test(code)) {
            inBlockComment = true;
            continue;
        }
        if (inBlockComment) {
            if (/^#(ce|comments-end)\b/i.test(code)) {
                inBlockComment = false;
            }
            continue;
        }
        if (code === '') {
            continue;
        }
        if (start < 0 && /^Func\b/i.test(code)) {
            start = i;
        }
        else if (start >= 0 && /^EndFunc\b/i.test(code)) {
            ranges.push({ start, end: i });
            start = -1;
        }
    }
    return ranges;
}
// Produce a single-test copy of the script. Only three things are kept:
//   1. the setup region — every line BEFORE the first test block,
//   2. the selected test block,
//   3. all function definitions (Func...EndFunc), wherever they appear.
// Everything else — other test blocks, and any top-level statement between/after test blocks
// (stray Exits, debug lines, test-specific setup that leaked outside a block) — is removed, so a
// single-test run can't inherit cross-test dependencies. Returns null if keepName wasn't found.
//
// IMPORTANT: dropped lines are BLANKED (replaced with an empty line) rather than deleted, so the
// output keeps the exact same line count and every kept line stays on its ORIGINAL line number.
// That keeps @ScriptLineNumber (and Au3Check errors, etc.) reporting the same numbers the user
// sees in the real script — the compaction that shifted them is what this avoids.
function buildSingleTestScript(text, keepName) {
    const blocks = findTests(text);
    const selected = blocks.find(b => b.name === keepName);
    if (!selected) {
        return null;
    }
    const lines = splitLines(text);
    const firstTestStart = Math.min(...blocks.map(b => b.startLine));
    const funcs = findFuncRanges(text);
    const exitLines = new Set(findTopLevelExitLines(text));
    const inFunc = (i) => funcs.some(f => i >= f.start && i <= f.end);
    const inSelected = (i) => i >= selected.startLine && i <= selected.endLine;
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        // never carry a standalone top-level Exit into a test run
        const keep = !exitLines.has(i) && (i < firstTestStart || inSelected(i) || inFunc(i));
        out.push(keep ? lines[i] : ''); // blank (not drop) so original line numbers are preserved
    }
    return out.join('\r\n');
}
//# sourceMappingURL=testScanner.js.map
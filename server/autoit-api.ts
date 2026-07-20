import * as fs from 'fs';

export interface FunctionSignature {
    name: string;
    documentation: string;
    parameters: { label: string; documentation?: string }[];
    // Optional full signature label; defaults to "name(param, param, ...)".
    // Every parameter label must appear verbatim in it or VS Code won't highlight the active parameter.
    label?: string;
    // Language keywords (With, If, For, ...): completion inserts a trailing space and no signature help is offered.
    keyword?: boolean;
}

// Parses a SciTE au3.api file: one entry per line, in the form "Name ( params ) Description".
// Duplicate names (e.g. the AutoItSetOption variants) each produce their own entry.
export function parseAu3Api(filePath: string): FunctionSignature[] {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries: FunctionSignature[] = [];
    for (const line of raw.split(/\r?\n/)) {
        const entry = parseLine(line.trim());
        if (entry) {
            entries.push(entry);
        }
    }
    return entries;
}

function parseLine(line: string): FunctionSignature | null {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(line);
    if (!m) {
        return null;
    }

    const name = m[1];
    const openParen = line.indexOf('(', name.length);
    const closeParen = findMatchingParen(line, openParen);
    if (closeParen === -1) {
        return null;
    }

    return {
        name,
        documentation: cleanDescription(line.slice(closeParen + 1)),
        parameters: splitParams(line.slice(openParen + 1, closeParen)).map(label => ({ label }))
    };
}

// Index of the ")" matching the "(" at openParen. Skips parens inside quoted strings
// (e.g. $sFilter = "All files (*.*)"). Returns -1 if unbalanced.
function findMatchingParen(line: string, openParen: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = openParen; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) { quote = null; }
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; continue; }
        if (ch === '(') { depth++; continue; }
        if (ch === ')') {
            depth--;
            if (depth === 0) { return i; }
        }
    }
    return -1;
}

// '"function" [, time = 250]' → ['"function"', 'time = 250'].
// Strips SciTE's optional-parameter brackets so each label is a verbatim substring of the
// rebuilt "name(p1, p2)" signature, which VS Code requires for active-parameter highlighting.
function splitParams(rawParams: string): string[] {
    const cleaned = rawParams.replace(/[\[\]]/g, '');
    const params: string[] = [];
    let current = '';
    let depth = 0;
    let quote: string | null = null;
    for (const ch of cleaned) {
        if (quote) {
            if (ch === quote) { quote = null; }
            current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
        if (ch === '(') { depth++; }
        if (ch === ')') { depth--; }
        if (ch === ',' && depth === 0) {
            params.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    params.push(current);
    return params.map(p => p.trim().replace(/\s+/g, ' ')).filter(p => p.length > 0);
}

// Descriptions embed <a href="...">/<a id="..."> anchors and HTML entities. Only anchor tags are
// stripped — text like "#include <Word.au3>" must survive intact.
function cleanDescription(raw: string): string {
    return raw
        .replace(/<\/?a\b[^>]*>/gi, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
}

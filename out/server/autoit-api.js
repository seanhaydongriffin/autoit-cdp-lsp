"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAu3Api = parseAu3Api;
const fs = __importStar(require("fs"));
// Parses a SciTE au3.api file: one entry per line, in the form "Name ( params ) Description".
// Duplicate names (e.g. the AutoItSetOption variants) each produce their own entry.
function parseAu3Api(filePath) {
    const raw = fs.readFileSync(filePath, 'utf8');
    const entries = [];
    for (const line of raw.split(/\r?\n/)) {
        const entry = parseLine(line.trim());
        if (entry) {
            entries.push(entry);
        }
    }
    return entries;
}
function parseLine(line) {
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
function findMatchingParen(line, openParen) {
    let depth = 0;
    let quote = null;
    for (let i = openParen; i < line.length; i++) {
        const ch = line[i];
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            continue;
        }
        if (ch === '(') {
            depth++;
            continue;
        }
        if (ch === ')') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
    }
    return -1;
}
// '"function" [, time = 250]' → ['"function"', 'time = 250'].
// Strips SciTE's optional-parameter brackets so each label is a verbatim substring of the
// rebuilt "name(p1, p2)" signature, which VS Code requires for active-parameter highlighting.
function splitParams(rawParams) {
    const cleaned = rawParams.replace(/[\[\]]/g, '');
    const params = [];
    let current = '';
    let depth = 0;
    let quote = null;
    for (const ch of cleaned) {
        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            current += ch;
            continue;
        }
        if (ch === '"' || ch === "'") {
            quote = ch;
            current += ch;
            continue;
        }
        if (ch === '(') {
            depth++;
        }
        if (ch === ')') {
            depth--;
        }
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
function cleanDescription(raw) {
    return raw
        .replace(/<\/?a\b[^>]*>/gi, '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .trim();
}
//# sourceMappingURL=autoit-api.js.map
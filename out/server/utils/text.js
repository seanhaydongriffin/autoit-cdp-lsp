"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrefix = getPrefix;
function getPrefix(text, offset) {
    let i = offset - 1;
    while (i >= 0 && /[A-Za-z0-9_.$]/.test(text[i])) {
        i--;
    }
    return text.slice(i + 1, offset);
}
//# sourceMappingURL=text.js.map
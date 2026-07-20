"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toAutoItFunctionName = toAutoItFunctionName;
function toAutoItFunctionName(domain, command) {
    return `CDP_${domain}_${command[0].toUpperCase()}${command.slice(1)}`;
}
//# sourceMappingURL=cdp-mapper.js.map
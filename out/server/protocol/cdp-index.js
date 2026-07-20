"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CdpIndex = void 0;
class CdpIndex {
    constructor(schema) {
        this.domainsByName = new Map();
        this.commandsByFullName = new Map();
        for (const domain of schema.domains) {
            this.domainsByName.set(domain.domain, domain);
            if (domain.commands) {
                for (const cmd of domain.commands) {
                    const fullName = `${domain.domain}.${cmd.name}`;
                    this.commandsByFullName.set(fullName, cmd);
                }
            }
        }
    }
    getDomain(name) {
        return this.domainsByName.get(name);
    }
    getCommand(fullName) {
        return this.commandsByFullName.get(fullName);
    }
    listCommandsForDomain(domainName) {
        const domain = this.domainsByName.get(domainName);
        return domain?.commands ?? [];
    }
}
exports.CdpIndex = CdpIndex;
//# sourceMappingURL=cdp-index.js.map
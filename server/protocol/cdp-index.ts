import { CdpSchema, CdpDomain, CdpCommand } from './cdp-types';

export interface CdpCommandKey {
    domain: string;
    name: string;
}

export class CdpIndex {
    private domainsByName = new Map<string, CdpDomain>();
    private commandsByFullName = new Map<string, CdpCommand>();

    constructor(schema: CdpSchema) {
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

    getDomain(name: string): CdpDomain | undefined {
        return this.domainsByName.get(name);
    }

    getCommand(fullName: string): CdpCommand | undefined {
        return this.commandsByFullName.get(fullName);
    }

    listCommandsForDomain(domainName: string): CdpCommand[] {
        const domain = this.domainsByName.get(domainName);
        return domain?.commands ?? [];
    }
}

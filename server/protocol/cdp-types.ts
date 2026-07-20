export interface CdpDomain {
    domain: string;
    commands?: CdpCommand[];
    events?: CdpEvent[];
    types?: CdpType[];
}

export interface CdpCommand {
    name: string;
    description?: string;
    parameters?: CdpField[];
    returns?: CdpField[];
}

export interface CdpEvent {
    name: string;
    description?: string;
    parameters?: CdpField[];
}

export interface CdpType {
    id: string;
    type: string;
    description?: string;
    properties?: CdpField[];
}

export interface CdpField {
    name: string;
    type?: string;
    optional?: boolean;
    description?: string;
    $ref?: string;
}

export interface CdpSchema {
    version: { major: string; minor: string };
    domains: CdpDomain[];
}

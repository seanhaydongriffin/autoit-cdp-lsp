export function toAutoItFunctionName(domain: string, command: string): string {
    return `CDP_${domain}_${command[0].toUpperCase()}${command.slice(1)}`;
}

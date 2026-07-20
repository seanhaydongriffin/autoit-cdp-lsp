export function getPrefix(text: string, offset: number): string {
    let i = offset - 1;
    while (i >= 0 && /[A-Za-z0-9_.$]/.test(text[i])) {
        i--;
    }
    return text.slice(i + 1, offset);
}

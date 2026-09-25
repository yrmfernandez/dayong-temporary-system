export function canonicalHeader(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function headerMatches(actual: unknown, expectedDisplayHeader: string): boolean {
  return canonicalHeader(actual) === canonicalHeader(expectedDisplayHeader);
}

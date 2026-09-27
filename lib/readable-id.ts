export function createReadableId(prefix: string) {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, "0");
  return `${prefix.toUpperCase()}-${timestamp}-${suffix}`;
}

export type Tone = "brand" | "success" | "warning" | "danger" | "info" | "teal" | "orange" | "neutral";

// Status words used across the Sheets workflows, grouped by what they ask of the reader.
const toneWords: Array<[Tone, RegExp]> = [
  ["danger", /\b(reject|void|inactive|absent|awol|discrepanc|shortage|resigned|overdue|failed|denied|cancel)/i],
  ["warning", /\b(pending|outstanding|review|late|undertime|due|draft|hold|partial)/i],
  ["success", /\b(approv|remitted|active|paid|present|posted|balanced|complete|claim|full|ok)\b/i],
  ["info", /\b(submitted|new|legacy|open|leave|scheduled)/i],
];

export function toneForStatus(status: string): Tone {
  return toneWords.find(([, pattern]) => pattern.test(status))?.[0] ?? "neutral";
}

/** Colour-coded status label. The text always carries the meaning; colour only reinforces it. */
export function StatusBadge({ status, tone }: { status: string; tone?: Tone }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  const resolved = tone ?? toneForStatus(status);
  return (
    <span className={`tone-chip tone-${resolved} inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {status}
    </span>
  );
}

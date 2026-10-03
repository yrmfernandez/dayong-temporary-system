/**
 * Shown at once while a server-rendered page (the dashboard above all) loads its data from Google Sheets, so a click
 * responds immediately instead of appearing to do nothing.
 */
export default function Loading() {
  return (
    <section className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="space-y-2">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
        <div className="h-7 w-64 animate-pulse rounded bg-muted" />
        <p className="text-sm text-muted-foreground">Loading the latest figures…</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="h-28 animate-pulse rounded-[1.25rem] bg-muted" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        {Array.from({ length: 2 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-xl bg-muted" />)}
      </div>
    </section>
  );
}

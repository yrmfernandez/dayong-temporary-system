"use client";

import { HandCoins, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { DenominationCounter } from "@/components/control-total-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/date-format";
import { cashCountTotal, type CashCounts } from "@/lib/entry-controls";
import { HANDOVER_NOTE_MAX, HANDOVER_NOTE_MIN, type HandoverMethod } from "@/lib/handover-rules";
import { toCents } from "@/lib/money";

/** Who is handing over: a MAS in a branch (from the batch the clerk pressed Mark remitted on). */
export type HandoverTarget = { employeeId: string; branchId: string; mas: string; branch: string };

type Batch = { kind: "New Sales" | "Collections"; id: string; count: number; collected: number; incentive: number; toRemit: number; late: boolean; deadline: string; submittedAt: string };
type Earlier = { id: string; at: string; covers: string; received: number; text: string; closed: boolean; counted: boolean };
type Options = { mas: string; branch: string; batches: Batch[]; earlier: Earlier[]; methods: HandoverMethod[] };
type Line = { method: string; amount: string; reference: string };

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

/**
 * Mark remitted, one handover (owner, November 28, 2026; from December 1, 2026; lib/mas-handover.ts). Opened from
 * New Sales or Collections → Submitted by MAS, it lists every batch the MAS is waiting to remit in the branch (both
 * kinds, ticked), asks how it was remitted (one line per method; + Add another method for part cash, the rest GCash or
 * bank), counts the cash by denomination, and shows received against expected. A short or over needs a note; it is
 * recorded when the last batch is saved. With an earlier handover today, the clerk says whether this is a new one (its
 * time decides the incentive) or part of the earlier one.
 */
export function MarkRemittedDialog({ target, onClose, onDone }: { target: HandoverTarget | null; onClose: () => void; onDone: (message: string) => void }) {
  // A fresh window (empty lines and count) each time it opens, for each MAS and branch.
  if (!target) return null;
  return <MarkRemittedWindow key={`${target.employeeId}|${target.branchId}`} target={target} onClose={onClose} onDone={onDone} />;
}

function MarkRemittedWindow({ target, onClose, onDone }: { target: HandoverTarget; onClose: () => void; onDone: (message: string) => void }) {
  const [options, setOptions] = useState<Options | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [lines, setLines] = useState<Line[]>([]);
  const [counts, setCounts] = useState<CashCounts>({});
  const [note, setNote] = useState("");
  const [handover, setHandover] = useState("new");

  useEffect(() => {
    let live = true;
    fetch(`/api/mas-handover?employeeId=${encodeURIComponent(target.employeeId)}&branchId=${encodeURIComponent(target.branchId)}`, { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() }))
      .then(({ response, result }) => {
        if (!live) return;
        if (!response.ok || !result.success) { setError(result.message || "Unable to load the batches."); return; }
        setOptions(result);
        setTicked(new Set((result.batches as Batch[]).map((batch) => batch.id)));
      })
      .catch(() => { if (live) setError("No connection. Close the window and try again."); });
    return () => { live = false; };
  }, [target]);

  const methodOf = (name: string) => options?.methods.find((method) => method.name === name);
  const cashLine = lines.find((line) => methodOf(line.method)?.isCash);
  const counted = cashCountTotal(counts);
  const expected = useMemo(() => (options?.batches ?? []).filter((batch) => ticked.has(batch.id)).reduce((cents, batch) => cents + toCents(batch.toRemit), 0) / 100, [options, ticked]);
  const received = lines.reduce((cents, line) => cents + toCents(methodOf(line.method)?.isCash ? counted : Number(line.amount) || 0), 0) / 100;
  const difference = (toCents(received) - toCents(expected)) / 100;
  const open = (options?.earlier ?? []).filter((item) => !item.closed);

  const problem = !options ? "" : !ticked.size ? "Tick at least one batch the MAS is handing over."
    : !lines.length ? "Choose how the MAS remitted."
    : cashLine && !counted ? "Count the cash: type how many pieces of each bill and coin."
    : lines.map((line) => {
      const method = methodOf(line.method);
      if (!method || method.isCash) return "";
      if (!(Number(line.amount) > 0)) return `Enter the ${line.method} amount.`;
      if (!/\d/.test(line.reference)) return `Enter the ${line.method} reference no. (the transaction or deposit slip number).`;
      return "";
    }).find(Boolean)
    || (difference && note.trim().length < HANDOVER_NOTE_MIN ? `Write a note for the ${difference < 0 ? "short" : "over"} (at least ${HANDOVER_NOTE_MIN} characters).` : "");

  const addLine = (name: string) => setLines((current) => [...current, { method: name, amount: "", reference: "" }]);
  const unused = (options?.methods ?? []).filter((method) => !lines.some((line) => line.method === method.name) && !(method.isCash && cashLine));

  async function submit() {
    if (problem || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/mas-handover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        employeeId: target.employeeId, branchId: target.branchId, batchIds: [...ticked], note, handover,
        lines: lines.map((line) => methodOf(line.method)?.isCash ? { method: line.method, counts } : { method: line.method, amount: Number(line.amount), reference: line.reference.trim() }),
      }) });
      const result = await response.json();
      if (!response.ok || !result.success) { setError(result.message || "Unable to mark it remitted."); return; }
      onDone(result.message);
    } catch { setError("The connection dropped. Reload Submitted by MAS to see whether it was marked before trying again."); }
    finally { setBusy(false); }
  }

  return createPortal(
    <div className="fixed inset-0 z-[55] flex items-start justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-labelledby="mark-remitted-title" className="my-auto w-full max-w-2xl space-y-4 rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><HandCoins className="size-4" /></span>
          <div className="min-w-0 space-y-1">
            <p id="mark-remitted-title" className="font-semibold">Mark remitted: {options?.mas || target.mas} · {target.branch}</p>
            <p className="text-sm text-muted-foreground">Only once the money is in your hands: this time decides the incentive. Everything the MAS hands over now is one handover.</p>
          </div>
        </div>

        {!options && !error && <p className="text-sm text-muted-foreground">Loading the batches…</p>}
        {options && (
          <>
            <section className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">1. What is the MAS handing over?</p>
              {!options.batches.length && <p className="text-sm text-muted-foreground">No batch of this MAS is waiting to be remitted in this branch.</p>}
              {options.batches.map((batch) => (
                <label key={batch.id} className="flex items-center justify-between gap-3 rounded-lg border p-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <input type="checkbox" className="size-4" checked={ticked.has(batch.id)} onChange={(event) => setTicked((current) => { const next = new Set(current); if (event.target.checked) next.add(batch.id); else next.delete(batch.id); return next; })} />
                    <span className="min-w-0">
                      <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${batch.kind === "New Sales" ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200" : "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200"}`}>{batch.kind}</span>
                      {batch.count} {batch.kind === "New Sales" ? `sale${batch.count === 1 ? "" : "s"}` : `member${batch.count === 1 ? "" : "s"}`} · submitted {formatDateTime(batch.submittedAt)}
                      {batch.late && <span className="block text-xs font-medium text-amber-700">Deadline passed: the whole amount is due, no incentive</span>}
                    </span>
                  </span>
                  <span className="shrink-0 text-right tabular-nums"><strong>{peso(batch.toRemit)}</strong><span className="block text-xs text-muted-foreground">{peso(batch.collected)} − {peso(batch.incentive)}</span></span>
                </label>
              ))}
              <p className="text-xs text-muted-foreground">To remit = collected − incentive (an estimate: the save works it out again, with Fidelity and any penalty). Untick a batch not paid yet: it stays waiting.</p>
            </section>

            {open.length > 0 && (
              <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                <p className="font-semibold">{options.mas} already handed over today</p>
                <label className="flex gap-2"><input type="radio" name="handover" checked={handover === "new"} onChange={() => setHandover("new")} /><span><strong>New handover now</strong>: this money came separately. Its own count; now decides the incentive.</span></label>
                {open.map((item) => (
                  <label key={item.id} className="flex gap-2"><input type="radio" name="handover" checked={handover === item.id} onChange={() => setHandover(item.id)} />
                    <span><strong>Part of the {item.at.slice(11)} handover</strong> ({item.covers}{item.counted ? `: ${item.text}` : ""}): I did not mark it then. It keeps {item.at.slice(11)}; what you enter here is added to it (count only this money).</span></label>
                ))}
              </section>
            )}

            <section className="space-y-2 border-t pt-3">
              <p className="text-sm font-semibold">2. How did they remit?</p>
              {!lines.length && (
                <div className="flex flex-wrap gap-2">
                  {options.methods.map((method) => <Button key={method.name} type="button" size="sm" variant="outline" onClick={() => addLine(method.name)}>{method.name}</Button>)}
                </div>
              )}
              {lines.map((line, index) => {
                const method = methodOf(line.method);
                return (
                  <div key={line.method} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[9rem_8rem_minmax(0,1fr)_auto]">
                    <span className="text-sm font-medium">{line.method}</span>
                    {method?.isCash ? <span className="text-sm tabular-nums text-muted-foreground sm:col-span-2">{counted ? peso(counted) : "count below"}</span> : <>
                      <Input type="number" min="0" step="0.01" placeholder="Amount" value={line.amount} onWheel={(event) => event.currentTarget.blur()} onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, amount: event.target.value } : item))} aria-label={`${line.method} amount`} />
                      <Input placeholder="Reference no." maxLength={100} value={line.reference} onChange={(event) => setLines((current) => current.map((item, at) => at === index ? { ...item, reference: event.target.value } : item))} aria-label={`${line.method} reference no.`} />
                    </>}
                    <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${line.method}`} onClick={() => { setLines((current) => current.filter((_, at) => at !== index)); if (method?.isCash) setCounts({}); }}><X className="size-4" /></Button>
                  </div>
                );
              })}
              {lines.length > 0 && unused.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="inline-flex items-center gap-1 text-muted-foreground"><Plus className="size-3.5" />Add another method (part cash, the rest GCash or bank):</span>
                  {unused.map((method) => <Button key={method.name} type="button" size="sm" variant="outline" onClick={() => addLine(method.name)}>{method.name}</Button>)}
                </div>
              )}
            </section>

            {cashLine && (
              <section className="space-y-2 border-t pt-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">3. Count the cash</p>
                  <Button type="button" size="sm" variant="ghost" disabled={!counted} onClick={() => setCounts({})}>Clear</Button>
                </div>
                <DenominationCounter id="handover-count" counts={counts} onCountsChange={setCounts} />
              </section>
            )}

            {lines.length > 0 && (
              <section className="space-y-1 rounded-lg bg-muted/50 p-3 text-sm">
                {lines.map((line) => {
                  const cash = methodOf(line.method)?.isCash;
                  return <div key={line.method} className="flex justify-between gap-2"><span>{line.method}{!cash && line.reference ? ` (ref ${line.reference})` : ""}{cash ? "" : " · not cash"}</span><span className="tabular-nums">{peso(cash ? counted : Number(line.amount) || 0)}</span></div>;
                })}
                <div className="flex justify-between gap-2 border-t pt-1 font-semibold"><span>Total received</span><span className="tabular-nums">{peso(received)}</span></div>
                <div className="flex justify-between gap-2"><span>Expected</span><span className="tabular-nums">{peso(expected)}</span></div>
                <p className={`font-semibold ${!difference ? "text-emerald-700" : difference < 0 ? "text-red-700" : "text-amber-700"}`}>{!difference ? "Matches the expected amount" : `${difference < 0 ? "Short" : "Over"} by ${peso(Math.abs(difference))}`}</p>
                {difference !== 0 && <Input aria-label="Note for the short or over" maxLength={HANDOVER_NOTE_MAX} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for the short or over (required), e.g. MAS to pay Monday" />}
                <p className="text-xs text-muted-foreground">The short or over is recorded when the last batch is saved, from the entries as saved; until then this is an estimate.</p>
              </section>
            )}
          </>
        )}

        {(error || (lines.length > 0 && problem)) && <p role="alert" className="text-sm text-red-700">{error || problem}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={() => void submit()} disabled={!options || Boolean(problem) || busy}>{busy ? "Saving…" : "Mark remitted"}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export type HandoverSummary = { id: string; at: string; text: string; received: number; method: string; reference: string; cash: boolean; closed: boolean; note: string };

/**
 * The handover a batch is saved under, when it was counted at Mark remitted (null otherwise, or while loading): the
 * encoding form then takes its method and reference and asks no cash count or turnover total (lib/mas-handover.ts).
 */
export function useHandover(clearingId: string, onLoad?: (handover: HandoverSummary) => void) {
  const [loaded, setLoaded] = useState<{ id: string; handover: HandoverSummary | null }>({ id: "", handover: null });
  const onLoadRef = useRef(onLoad);
  useEffect(() => { onLoadRef.current = onLoad; });
  useEffect(() => {
    if (!clearingId) return;
    let live = true;
    fetch(`/api/mas-handover?clearingId=${encodeURIComponent(clearingId)}`, { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((result) => {
        if (!live || !result?.success) return;
        setLoaded({ id: clearingId, handover: result.handover ?? null });
        if (result.handover) onLoadRef.current?.(result.handover);
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [clearingId]);
  return clearingId && loaded.id === clearingId ? loaded.handover : null;
}

/** In the save bar in place of Cash counted / Control total: what was handed over, counted at Mark remitted. */
export function HandoverSaveBar({ handover }: { handover: HandoverSummary }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${handover.closed ? "border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100" : "bg-muted/40"}`}>
      <p><strong>Handover {handover.at.slice(11)}</strong> · {handover.text} · received <strong className="tabular-nums">{peso(handover.received)}</strong></p>
      <p className="text-xs text-muted-foreground">{handover.closed
        ? "This handover was already counted and closed when its last batch was saved. For more money, mark it remitted as a new handover."
        : "Counted at Mark remitted: no cash count here. The short or over of the whole handover (New Sales and Collections) is worked out when its last batch is saved."}</p>
    </div>
  );
}

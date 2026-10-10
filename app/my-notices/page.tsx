"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { readApiResponse } from "@/lib/api-response";
import type { Nte } from "@/lib/nte";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Data = { notices: Nte[]; active: number; today: string; days: number; threshold: number; explanationMax: number };
const when = (value: string) => value ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "";

/**
 * My Notices: the signed-in employee's own Notices to Explain (lib/nte.ts). A new notice shows here, in the sidebar
 * count and in a banner on every page until the employee confirms receipt and sends their explanation.
 */
export default function MyNoticesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/nte/mine", { cache: "no-store" });
    const result = await readApiResponse(response);
    if (response.ok && result.success) setData(result as unknown as Data); else setMessage(result.message || "Unable to load your notices.");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the notices once
    void load();
  }, [load]);
  useLiveRefresh(["notices_to_explain"], load);

  const send = async (body: Record<string, unknown>) => {
    setBusy(String(body.id)); setMessage("");
    try {
      const response = await fetch("/api/nte/mine", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readApiResponse(response);
      if (result.message) setMessage(result.message);
      if (response.ok && result.success) { await load(); window.dispatchEvent(new Event("notifications:refresh")); }
      return response.ok && result.success;
    } finally { setBusy(""); }
  };

  const notices = data?.notices ?? [];
  return <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold">My Notices</h1>
      <p className="text-sm text-muted-foreground">Notices to Explain (NTE) issued to you. A notice is in force for {data?.days ?? 90} days from the date issued; {data?.threshold ?? 3} or more in force at once make you subject to suspension. Confirm that you received each notice and write your explanation while it is in force.</p>
    </div>
    {data && data.active >= data.threshold && <div role="alert" className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800"><AlertTriangle className="size-4" />You have {data.active} notices in force and are subject to suspension.</div>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {!data && <p className="text-sm text-muted-foreground">Loading...</p>}
    {data && !notices.length && <p className="rounded-xl border bg-background p-6 text-center text-sm text-muted-foreground">You have no notices.</p>}
    {notices.map((nte) => {
      const open = nte.status === "Active";
      const writing = open && (!nte.explanation || editing === nte.id);
      const draft = drafts[nte.id] ?? nte.explanation;
      return <article key={nte.id} className={`space-y-3 rounded-xl border bg-background p-4 ${open && !nte.explanation ? "border-amber-300" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{nte.reason}</h2>
            <p className="text-xs text-muted-foreground">{nte.id} · issued {nte.issuedOn}{nte.issuedBy ? ` by ${nte.issuedBy}` : ""} · {open ? `in force until ${nte.expiresOn}` : nte.status === "Expired" ? `expired ${nte.expiresOn}` : "withdrawn"}</p>
          </div>
          <StatusBadge status={nte.status} tone={open ? "warning" : undefined} />
        </div>
        {nte.details && <p className="whitespace-pre-wrap text-sm">{nte.details}</p>}
        {nte.withdrawnReason && <p className="text-sm text-muted-foreground">Withdrawn: {nte.withdrawnReason}. It no longer counts.</p>}
        {nte.acknowledgedAt
          ? <p className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="size-3.5" />You confirmed receipt on {when(nte.acknowledgedAt)}.</p>
          : <Button type="button" size="sm" variant="outline" disabled={busy === nte.id} onClick={() => void send({ id: nte.id, action: "acknowledge" })}>I have received and read this notice</Button>}
        {nte.explanation && !writing && <div className="rounded-lg bg-muted/40 p-3 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Your explanation · sent {when(nte.explainedAt)}</p>
          <p className="mt-1 whitespace-pre-wrap">{nte.explanation}</p>
          {open && <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => { setEditing(nte.id); setDrafts((current) => ({ ...current, [nte.id]: nte.explanation })); }}>Revise my explanation</Button>}
        </div>}
        {writing && <form className="space-y-2" onSubmit={async (event) => { event.preventDefault(); if (await send({ id: nte.id, action: "explain", explanation: draft })) { setEditing(""); setDrafts((current) => { const next = { ...current }; delete next[nte.id]; return next; }); } }}>
          <label className="block text-sm font-medium" htmlFor={`explain-${nte.id}`}>Your explanation *</label>
          <Textarea id={`explain-${nte.id}`} rows={5} required minLength={3} maxLength={data?.explanationMax} value={draft} onChange={(event) => setDrafts((current) => ({ ...current, [nte.id]: event.target.value }))} placeholder="Explain what happened." />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy === nte.id || draft.trim().length < 3}>{busy === nte.id ? "Sending..." : nte.explanation ? "Send revised explanation" : "Send explanation"}</Button>
            {nte.explanation && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing("")}>Cancel</Button>}
          </div>
        </form>}
      </article>;
    })}
  </div>;
}

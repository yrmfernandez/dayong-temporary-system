"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, ExternalLink, Eye, Megaphone, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { UpdatePopup } from "@/components/update-popup";
import { readApiResponse } from "@/lib/api-response";
import { formatDateTime as showDateTime } from "@/lib/date-format";
import type { SystemUpdate, UpdateStep } from "@/lib/system-updates";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type ViewerUpdate = Omit<SystemUpdate, "steps"> & { seen: boolean; steps: Array<UpdateStep & { canOpen: boolean }> };
type ManagedUpdate = SystemUpdate & { seenCount: number };
type Data = { updates: ViewerUpdate[]; canManage: boolean; all?: ManagedUpdate[]; roles?: string[]; pages?: Array<{ name: string; href: string }> };
type Form = { id: string; title: string; summary: string; steps: UpdateStep[]; audience: string[] };
const emptyForm: Form = { id: "", title: "", summary: "", steps: [{ text: "", path: "" }], audience: [] };
const field = "mt-1 w-full rounded-md border bg-background p-2 text-sm font-normal";

export default function UpdatesPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-muted-foreground">Loading...</p>}><Updates /></Suspense>;
}

/**
 * System Updates (lib/system-updates.ts, November 12, 2026): what changed in the system, each with a step-by-step guide
 * that opens the page where it happens. IT and Administrators write them and announce them (a pop-up to everyone they
 * are for). `?guide=<id>` opens one update's guide (the pop-up's Go to updates).
 */
function Updates() {
  const router = useRouter();
  const guideId = useSearchParams().get("guide") ?? "";
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/updates", { cache: "no-store" });
      const result = await readApiResponse(response);
      if (response.ok && result.success) setData(result as unknown as Data); else setMessage(result.message || "Unable to load the updates.");
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to load the updates."); }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the updates once
    void load();
  }, [load]);
  useLiveRefresh(["system_updates"], load);

  // Opening a guide counts as seeing it, and starts at its first step.
  useEffect(() => {
    if (!guideId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new guide starts at step 1
    setStep(0);
    void fetch("/api/updates", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "opened", id: guideId }) }).then(() => window.dispatchEvent(new Event("notifications:refresh"))).catch(() => undefined);
  }, [guideId]);

  const guide = guideId ? data?.updates.find((update) => update.id === guideId) ?? null : null;
  const openGuide = (id: string) => router.push(`/updates?guide=${encodeURIComponent(id)}`);

  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="page-hero">
      <div className="flex items-center gap-4">
        <div className="tone-soft tone-brand rounded-2xl p-3"><Megaphone className="size-8" /></div>
        <div>
          <h1 className="text-2xl font-bold">System Updates</h1>
          <p className="mt-1 text-sm text-muted-foreground">What changed in the system and how to use it. Open an update for a step-by-step guide that takes you to each page.</p>
        </div>
      </div>
    </header>
    {message && <p role="status" className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">{message}</p>}

    {guideId && data && (guide ? <Guide update={guide} step={Math.min(step, Math.max(guide.steps.length - 1, 0))} onStep={setStep} onClose={() => router.push("/updates")} />
      : <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">This update is no longer announced. <Link className="font-medium text-primary underline" href="/updates">See all updates</Link></p>)}

    {!guideId && <div className="space-y-3">
      {!data && <p className="text-sm text-muted-foreground">Loading...</p>}
      {data && !data.updates.length && <p className="rounded-xl border bg-background p-8 text-center text-muted-foreground">No system updates yet.</p>}
      {data?.updates.map((update) => <article key={update.id} className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="flex flex-wrap items-center gap-2 font-semibold">{update.title}{!update.seen && <StatusBadge status="New" tone="brand" />}</h2>
            <p className="text-xs text-muted-foreground">{update.announcedBy ? `${update.announcedBy} · ` : ""}{showDateTime(update.announcedAt)}</p>
          </div>
          {update.steps.length > 0 && <Button type="button" size="sm" onClick={() => openGuide(update.id)}>Show me how<ArrowRight /></Button>}
        </div>
        <p className="mt-2 whitespace-pre-line text-sm">{update.summary}</p>
        {update.steps.length > 0 && <ol className="mt-3 list-inside list-decimal space-y-1 text-sm text-muted-foreground">{update.steps.map((item, index) => <li key={index}>{item.text}</li>)}</ol>}
      </article>)}
    </div>}

    {data?.canManage && !guideId && <Manage data={data} busy={busy} setBusy={setBusy} setMessage={setMessage} reload={load} />}
  </section>;
}

/** One update as a guide: a step at a time, each with the page it happens on. */
function Guide({ update, step, onStep, onClose }: { update: ViewerUpdate; step: number; onStep: (step: number) => void; onClose: () => void }) {
  const current = update.steps[step], last = step >= update.steps.length - 1;
  return <article className="space-y-4 rounded-2xl border-2 border-primary/30 bg-card p-5 shadow-sm">
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-primary">System update guide</p>
      <h2 className="text-xl font-bold">{update.title}</h2>
      <p className="whitespace-pre-line text-sm text-muted-foreground">{update.summary}</p>
    </div>
    {current ? <>
      <div className="flex gap-1" aria-hidden>{update.steps.map((_, index) => <span key={index} className={`h-1.5 flex-1 rounded-full ${index <= step ? "bg-primary" : "bg-muted"}`} />)}</div>
      <div className="rounded-xl bg-muted/50 p-4">
        <p className="text-xs font-semibold text-muted-foreground">Step {step + 1} of {update.steps.length}</p>
        <p className="mt-1 whitespace-pre-line text-base">{current.text}</p>
        {current.path && (current.canOpen
          ? <Link href={current.path} target="_blank" className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-background px-3 py-2 text-sm font-medium text-primary hover:bg-primary/5">Take me there<ExternalLink className="size-3.5" /></Link>
          : <p className="mt-2 text-xs text-muted-foreground">This page is not in your workspace.</p>)}
      </div>
      <div className="flex flex-wrap justify-between gap-2">
        <Button type="button" variant="outline" disabled={step === 0} onClick={() => onStep(step - 1)}><ArrowLeft />Back</Button>
        {last ? <Button type="button" onClick={onClose}><CheckCircle2 />Done</Button> : <Button type="button" onClick={() => onStep(step + 1)}>Next<ArrowRight /></Button>}
      </div>
    </> : <div className="flex justify-end"><Button type="button" onClick={onClose}><CheckCircle2 />Done</Button></div>}
    <p className="text-xs text-muted-foreground">Take me there opens the page in a new tab, so this guide stays open here.</p>
  </article>;
}

/** IT and Administrators: write an update, preview its pop-up, announce it or take it back. */
function Manage({ data, busy, setBusy, setMessage, reload }: { data: Data; busy: boolean; setBusy: (busy: boolean) => void; setMessage: (message: string) => void; reload: () => Promise<void> }) {
  const [form, setForm] = useState<Form>(emptyForm);
  const [preview, setPreview] = useState<ManagedUpdate | null>(null);
  const editing = data.all?.find((update) => update.id === form.id);

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/updates", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save.");
      setMessage(String(result.message ?? "")); after?.(); await reload();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to save."); }
    finally { setBusy(false); }
  }
  const setStepAt = (index: number, change: Partial<UpdateStep>) => setForm((current) => ({ ...current, steps: current.steps.map((item, at) => (at === index ? { ...item, ...change } : item)) }));
  const toggleRole = (role: string) => setForm((current) => ({ ...current, audience: current.audience.includes(role) ? current.audience.filter((item) => item !== role) : [...current.audience, role] }));

  return <div className="space-y-4 border-t pt-6">
    <div>
      <h2 className="text-lg font-bold">Write and announce updates</h2>
      <p className="text-sm text-muted-foreground">Only IT and Administrators see this. Save a draft, preview its pop-up, then announce it: everyone it is for sees the pop-up once (it cannot be closed for 5 seconds), and Go to updates opens the guide.</p>
    </div>

    <form className="space-y-3 rounded-xl border bg-card p-4" onSubmit={(event) => { event.preventDefault(); void send("POST", form, () => { if (!form.id) setForm(emptyForm); }); }}>
      <h3 className="font-semibold">{form.id ? `Editing: ${editing?.title ?? form.title}` : "New update"}</h3>
      {editing?.status === "Announced" && <p className="text-xs text-amber-700 dark:text-amber-400">Already announced: saving changes it on the Updates page, and those who saw it are not shown the pop-up again.</p>}
      <label className="block text-sm font-medium">Title<Input data-keep-case className="mt-1" maxLength={120} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Weekly reports now show Week 1, Week 2..." /></label>
      <label className="block text-sm font-medium">Pop-up message<textarea data-keep-case className={`${field} min-h-20`} maxLength={600} value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder="What changed and why it matters, in two or three sentences." /></label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Guide steps <span className="font-normal text-muted-foreground">(what to do, and the page where it happens)</span></legend>
        {form.steps.map((item, index) => <div key={index} className="flex flex-wrap items-start gap-2 rounded-lg border p-2">
          <span className="mt-2 w-6 text-sm font-semibold text-muted-foreground">{index + 1}.</span>
          <textarea data-keep-case aria-label={`Step ${index + 1}`} className={`${field} mt-0 min-h-14 flex-1 basis-64`} maxLength={400} value={item.text} onChange={(event) => setStepAt(index, { text: event.target.value })} placeholder="Open Reports, choose Weekly, then..." />
          <select aria-label={`Step ${index + 1} page`} className="h-9 rounded-md border bg-background px-2 text-sm" value={item.path} onChange={(event) => setStepAt(index, { path: event.target.value })}>
            <option value="">No page</option>
            {data.pages?.map((choice) => <option key={choice.href} value={choice.href}>{choice.name}</option>)}
          </select>
          <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove step ${index + 1}`} onClick={() => setForm({ ...form, steps: form.steps.filter((_, at) => at !== index) })}><Trash2 /></Button>
        </div>)}
        {form.steps.length < 12 && <Button type="button" size="sm" variant="outline" onClick={() => setForm({ ...form, steps: [...form.steps, { text: "", path: "" }] })}><Plus />Add a step</Button>}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">Who sees it</legend>
        <label className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={!form.audience.length} onChange={() => setForm({ ...form, audience: [] })} />Everyone</label>
        {data.roles?.map((role) => <label key={role} className="mr-4 inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={form.audience.includes(role.toLowerCase())} onChange={() => toggleRole(role.toLowerCase())} />{role}</label>)}
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{form.id ? "Save changes" : "Save draft"}</Button>
        {form.id && <Button type="button" variant="outline" onClick={() => setForm(emptyForm)}>Cancel</Button>}
      </div>
    </form>

    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-3">Update</th><th className="p-3">For</th><th className="p-3">Status</th><th className="p-3">Seen by</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>
          {data.all?.map((update) => <tr key={update.id} className="border-t align-top">
            <td className="p-3"><p className="font-medium">{update.title}</p><p className="text-xs text-muted-foreground">{update.steps.length} step{update.steps.length === 1 ? "" : "s"} · by {update.createdBy || "IT"}</p></td>
            <td className="p-3 text-xs">{update.audience.length ? update.audience.join(", ") : "Everyone"}</td>
            <td className="p-3"><StatusBadge status={update.status} tone={update.status === "Announced" ? "success" : "neutral"} />{update.announcedAt && <p className="mt-1 text-xs text-muted-foreground">{showDateTime(update.announcedAt)}</p>}</td>
            <td className="p-3">{update.status === "Announced" ? `${update.seenCount} user${update.seenCount === 1 ? "" : "s"}` : "-"}</td>
            <td className="p-3"><div className="flex flex-wrap justify-end gap-1">
              <Button type="button" size="xs" variant="ghost" onClick={() => setPreview(update)}><Eye />Preview</Button>
              <Button type="button" size="xs" variant="outline" onClick={() => { setForm({ id: update.id, title: update.title, summary: update.summary, steps: update.steps.length ? update.steps : [{ text: "", path: "" }], audience: update.audience }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</Button>
              {update.status === "Draft"
                ? <>
                  <Button type="button" size="xs" disabled={busy} onClick={() => { if (window.confirm(`Announce "${update.title}"? Everyone it is for gets the pop-up.`)) void send("PATCH", { action: "announce", id: update.id }); }}><Megaphone />Announce</Button>
                  <Button type="button" size="xs" variant="destructive" disabled={busy} onClick={() => { if (window.confirm(`Delete the draft "${update.title}"?`)) void send("PATCH", { action: "delete", id: update.id }); }}>Delete</Button>
                </>
                : <Button type="button" size="xs" variant="outline" disabled={busy} onClick={() => { if (window.confirm(`Take "${update.title}" back to a draft? It stops showing to everyone.`)) void send("PATCH", { action: "withdraw", id: update.id }); }}>Take back</Button>}
            </div></td>
          </tr>)}
          {!data.all?.length && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">No updates written yet.</td></tr>}
        </tbody>
      </table>
    </div>
    {/* The pop-up exactly as users will see it; closing the preview marks nothing. */}
    {preview && <UpdatePopup preview update={{ id: preview.id, title: preview.title, summary: preview.summary, steps: preview.steps.length, announcedAt: preview.announcedAt, announcedBy: preview.announcedBy }} onDone={() => setPreview(null)} onGuide={() => setPreview(null)} />}
  </div>;
}

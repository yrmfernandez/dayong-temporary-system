"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserRoundCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Found = { id: string; number: string; name: string; birthdate: string };
type Receipt = { id: string; orNumber: string; orDate: string; amount: number; months: number; nopFrom: number; nopTo: number; monthFrom: string; monthTo: string; remittance: string };
type Account = { id: string; programId: string; program: string; branch: string; mas: string; doi: string; rate: number; flexible: boolean; status: string; firstNop: number; start: { nop: number; month: string }; receipts: Receipt[] };
type Member = { member: { id: string; number: string; surname: string; firstName: string; middleName: string; nameExtension: string; birthdate: string }; accounts: Account[] };
type Result = { applied: boolean; summary: string; receipts: Array<{ id: string; orNumber: string; orDate: string; amount: number; account: string; program: string; before: string; after: string }>; statuses: Array<{ account: string; program: string; before: string; after: string }>; notes: string[] };
type Tool = "coverage" | "move" | "insert" | "merge" | "split";

const TOOLS: Array<[Tool, string, string]> = [
  ["coverage", "Fix coverage", "Set where an account's numbering starts (NOP and Month of) and each receipt's months; the receipts are numbered again in OR-date order."],
  ["move", "Move receipts", "Move several receipts to another account of this member; both accounts are numbered again."],
  ["insert", "Insert missing receipt", "Add a receipt that was never encoded. It is saved as already remitted (no slip), so it does not enter Clearing or Remittances."],
  ["merge", "Merge members", "Another member is the same person: everything of theirs moves to this member and the duplicate is removed."],
  ["split", "Split member", "Some receipts belong to a different person: a new member with an account in the same program takes them."],
];
const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
const nop = (receipt: Receipt) => `NOP ${receipt.nopFrom}${receipt.nopTo > receipt.nopFrom ? `-${receipt.nopTo}` : ""} (${receipt.monthFrom}${receipt.monthTo !== receipt.monthFrom ? ` to ${receipt.monthTo}` : ""})`;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const field = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/**
 * Member Corrections (owner, October 24, 2026; upgrade #4): fix coverage, move receipts, insert a missing receipt, merge
 * and split members (lib/member-corrections.ts). Each tool previews the exact result first; saving needs a reason.
 */
export default function MemberCorrectionsPage() {
  const [member, setMember] = useState<Member | null>(null);
  const [tool, setTool] = useState<Tool>("coverage");
  const [error, setError] = useState("");
  const load = useCallback(async (id: string) => {
    setError("");
    try {
      const response = await fetch(`/api/member-corrections?member=${encodeURIComponent(id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the member.");
      setMember(result);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load the member."); }
  }, []);

  return <section className="mx-auto max-w-6xl space-y-6">
    <header className="rounded-2xl page-hero p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><UserRoundCog className="size-6" /></div>
        <div><h1 className="text-2xl font-bold">Member Corrections</h1><p className="text-sm text-violet-30/80">Repair a member&apos;s records: coverage and NOPs, receipts on the wrong account, a missing receipt, a duplicate member, or two people under one member. Every tool shows the exact result before anything is saved; saving needs a reason and is kept in the Audit Log and Record Corrections.</p></div></div>
    </header>
    <Card><CardContent className="space-y-3 pt-5">
      <MemberPicker label="Member" onPick={(found) => void load(found.id)} />
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </CardContent></Card>
    {member && <>
      <MemberSummary member={member} />
      <div role="tablist" className="flex flex-wrap gap-1 border-b">{TOOLS.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tool === id} onClick={() => setTool(id)} className={`border-b-2 px-3 py-2.5 text-sm font-medium ${tool === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}>{label}</button>)}</div>
      <p className="text-sm text-muted-foreground">{TOOLS.find(([id]) => id === tool)?.[2]}</p>
      <ToolPanel key={`${tool}-${member.member.id}`} tool={tool} member={member} onSaved={(nextId) => void load(nextId ?? member.member.id)} />
    </>}
  </section>;
}

function MemberPicker({ label, onPick, exclude }: { label: string; onPick: (found: Found) => void; exclude?: string }) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/member-corrections?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json()).then((result) => setFound((result.members ?? []).filter((item: Found) => item.id !== exclude))).catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, exclude]);
  return <div className="space-y-2">
    <Label htmlFor={`pick-${label}`}>{label}</Label>
    <Input id={`pick-${label}`} placeholder="PH number or name (at least 2 letters)" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim().length < 2) setFound([]); }} />
    {query.trim().length >= 2 && found.length > 0 && <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">{found.map((item) => <li key={item.id}>
      <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => { onPick(item); setQuery(""); setFound([]); }}><strong>{item.name}</strong> <span className="text-muted-foreground">{item.number}{item.birthdate ? ` · born ${item.birthdate}` : ""}</span></button>
    </li>)}</ul>}
  </div>;
}

function MemberSummary({ member }: { member: Member }) {
  const m = member.member;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">{m.surname}, {[m.firstName, m.middleName, m.nameExtension].filter(Boolean).join(" ")} · {m.number}{m.birthdate ? ` · born ${m.birthdate}` : ""}</CardTitle></CardHeader>
    <CardContent className="space-y-4">{member.accounts.length ? member.accounts.map((account) => <div key={account.id} className="space-y-1">
      <p className="text-sm font-semibold">{account.program} · {account.id} <span className="font-normal text-muted-foreground">· {peso(account.rate)}{account.flexible ? " minimum" : ""}/month · DOI {account.doi} · {account.branch} · {account.mas} · {account.status || "—"}</span></p>
      <ReceiptTable receipts={account.receipts} />
    </div>) : <p className="text-sm text-muted-foreground">No accounts.</p>}</CardContent></Card>;
}

function ReceiptTable({ receipts, tick }: { receipts: Receipt[]; tick?: { chosen: Set<string>; toggle: (id: string) => void } }) {
  if (!receipts.length) return <p className="text-xs text-muted-foreground">No posted receipts.</p>;
  return <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/50 text-left"><tr>{tick && <th className="w-8 p-2" />}<th className="p-2">OR</th><th className="p-2">OR date</th><th className="p-2 text-right">Amount</th><th className="p-2">Coverage</th><th className="p-2">Remittance</th></tr></thead>
    <tbody>{receipts.map((receipt) => <tr key={receipt.id} className="border-t">{tick && <td className="p-2"><input type="checkbox" aria-label={`Select OR ${receipt.orNumber}`} checked={tick.chosen.has(receipt.id)} onChange={() => tick.toggle(receipt.id)} /></td>}
      <td className="p-2 font-medium">{receipt.orNumber || receipt.id}</td><td className="p-2 tabular-nums">{receipt.orDate}</td><td className="p-2 text-right tabular-nums">{peso(receipt.amount)}</td><td className="p-2">{nop(receipt)}</td><td className="p-2 text-xs text-muted-foreground">{receipt.remittance}</td></tr>)}</tbody></table></div>;
}

/** One tool's form, its preview and the save with a reason. The preview is cleared whenever the form changes. */
function ToolPanel({ tool, member, onSaved }: { tool: Tool; member: Member; onSaved: (memberId?: string) => void }) {
  const accounts = member.accounts;
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const account = accounts.find((item) => item.id === accountId);
  const [form, setForm] = useState<Record<string, string>>({});
  const [months, setMonths] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [other, setOther] = useState<Found | null>(null);
  const [shared, setShared] = useState<string[]>([]);
  const [useOtherName, setUseOtherName] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const set = (key: string, value: string) => { setForm((current) => ({ ...current, [key]: value })); setPreview(null); };
  const toggle = (id: string) => { setChosen((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); setPreview(null); };
  const number = (value: string | undefined) => (value === undefined || value === "" ? undefined : Number(value));

  useEffect(() => {
    if (!other) return;
    fetch(`/api/member-corrections?keep=${encodeURIComponent(member.member.id)}&other=${encodeURIComponent(other.id)}`, { cache: "no-store" })
      .then((response) => response.json()).then((result) => setShared(result.shared ?? [])).catch(() => setShared([]));
  }, [other, member.member.id]);

  const input = useMemo(() => {
    if (tool === "coverage") return { enrollmentId: accountId, startNop: number(form.startNop), startMonth: form.startMonth || undefined, doi: form.doi || undefined,
      months: Object.fromEntries(Object.entries(months).filter(([, value]) => value !== "").map(([id, value]) => [id, Number(value)])) };
    if (tool === "move") return { collectionIds: [...chosen], targetEnrollmentId: form.target ?? "" };
    if (tool === "insert") return { enrollmentId: accountId, orNumber: form.orNumber ?? "", orDate: form.orDate ?? "", amount: number(form.amount), months: number(form.months ?? "1"), collectedByRole: form.role || "MAS",
      mas: form.mas || account?.mas, dateRemitted: form.dateRemitted || undefined, startNop: number(form.startNop), startMonth: form.startMonth || undefined };
    if (tool === "merge") return { keepMemberId: member.member.id, otherMemberId: other?.id ?? "", useOtherName };
    return { enrollmentId: accountId, collectionIds: [...chosen].filter((id) => account?.receipts.some((receipt) => receipt.id === id)), newDoi: form.newDoi ?? "", newStartNop: number(form.startNop), newStartMonth: form.startMonth || undefined,
      keepFirstName: form.keepFirstName || undefined, newMember: { surname: form.surname ?? "", firstName: form.firstName ?? "", middleName: form.middleName, nameExtension: form.nameExtension, birthdate: form.birthdate } };
  }, [tool, accountId, account, form, months, chosen, other, useOtherName, member.member.id]);

  async function send(apply: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/member-corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, input, reason, apply }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to work out the correction.");
      if (apply) { setPreview(null); setReason(""); setMessage(`Saved. ${result.result.summary}`); onSaved(); }
      else setPreview(result.result);
    } catch (failure) { setPreview(null); setMessage(failure instanceof Error ? failure.message : "Unable to work out the correction."); }
    finally { setBusy(false); }
  }

  const accountSelect = <div className="space-y-1"><Label htmlFor="tool-account">Account</Label>
    <select id="tool-account" className={field} value={accountId} onChange={(event) => { setAccountId(event.target.value); setMonths({}); setChosen(new Set()); setPreview(null); }}>
      {accounts.map((item) => <option key={item.id} value={item.id}>{item.program} · {item.id} ({item.receipts.length} receipts)</option>)}
    </select></div>;
  const startFields = (hint: string) => <div className="grid gap-3 sm:grid-cols-2">
    <div className="space-y-1"><Label htmlFor="start-nop">First NOP</Label><Input id="start-nop" type="number" min={1} placeholder={hint} value={form.startNop ?? ""} onChange={(event) => set("startNop", event.target.value)} /></div>
    <div className="space-y-1"><Label htmlFor="start-month">Month of the first NOP</Label><Input id="start-month" type="month" value={form.startMonth ?? ""} onChange={(event) => set("startMonth", event.target.value)} /></div>
  </div>;

  return <Card><CardContent className="space-y-4 pt-5">
    {tool === "coverage" && account && <>
      {accountSelect}
      {startFields(`now ${account.start.nop} (${account.start.month})`)}
      <p className="text-xs text-muted-foreground">Blank keeps the current start: NOP {account.start.nop} in {account.start.month}. The first receipt by OR date gets the first NOP; each next receipt continues after the one before. Months below: blank keeps the receipt&apos;s months.</p>
      <div className="space-y-1 sm:w-60"><Label htmlFor="cov-doi">DOI</Label><Input id="cov-doi" type="date" max={today()} placeholder={account.doi} value={form.doi ?? account.doi} onChange={(event) => set("doi", event.target.value)} /></div>
      <div className="overflow-x-auto rounded-md border"><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">OR</th><th className="p-2">OR date</th><th className="p-2 text-right">Amount</th><th className="p-2">Now</th><th className="w-32 p-2">Months</th></tr></thead>
        <tbody>{account.receipts.map((receipt) => <tr key={receipt.id} className="border-t"><td className="p-2 font-medium">{receipt.orNumber}</td><td className="p-2">{receipt.orDate}</td><td className="p-2 text-right">{peso(receipt.amount)}</td><td className="p-2">{nop(receipt)}</td>
          <td className="p-2"><Input type="number" min={1} max={120} aria-label={`Months for OR ${receipt.orNumber}`} placeholder={String(receipt.months)} value={months[receipt.id] ?? ""} onChange={(event) => { setMonths((current) => ({ ...current, [receipt.id]: event.target.value })); setPreview(null); }} /></td></tr>)}</tbody></table></div>
    </>}

    {tool === "move" && <>
      {accounts.length < 2 ? <p className="text-sm text-muted-foreground">This member has one account. To give receipts to another person, use Split member.</p> : <>
        {accounts.map((item) => <div key={item.id} className="space-y-1"><p className="text-sm font-semibold">{item.program} · {item.id}</p><ReceiptTable receipts={item.receipts} tick={{ chosen, toggle }} /></div>)}
        <div className="space-y-1 sm:w-96"><Label htmlFor="move-target">Move the {chosen.size} ticked receipt(s) to</Label>
          <select id="move-target" className={field} value={form.target ?? ""} onChange={(event) => set("target", event.target.value)}><option value="">Choose the account</option>{accounts.map((item) => <option key={item.id} value={item.id}>{item.program} · {item.id}</option>)}</select></div>
        <p className="text-xs text-muted-foreground">A receipt moving to a program of another monthly pay is counted at the new pay (it must be a whole number of months there).</p>
      </>}
    </>}

    {tool === "insert" && account && <>
      {accountSelect}
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="ins-or">OR number</Label><Input id="ins-or" placeholder="e.g. 12665 B" value={form.orNumber ?? ""} onChange={(event) => set("orNumber", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="ins-date">OR date</Label><Input id="ins-date" type="date" max={today()} value={form.orDate ?? ""} onChange={(event) => set("orDate", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="ins-amount">Amount</Label><Input id="ins-amount" type="number" min="0.01" step="0.01" placeholder={String(account.rate)} value={form.amount ?? ""} onChange={(event) => set("amount", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="ins-months">Months covered</Label><Input id="ins-months" type="number" min={1} max={120} value={form.months ?? "1"} onChange={(event) => set("months", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="ins-role">Collected by</Label><select id="ins-role" className={field} value={form.role ?? "MAS"} onChange={(event) => set("role", event.target.value)}>{["MAS", "Collector", "DTO"].map((role) => <option key={role}>{role}</option>)}</select></div>
        <div className="space-y-1"><Label htmlFor="ins-mas">MAS / Collector name</Label><Input id="ins-mas" placeholder={account.mas} value={form.mas ?? ""} onChange={(event) => set("mas", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="ins-remitted">Date remitted</Label><Input id="ins-remitted" type="date" max={today()} value={form.dateRemitted ?? ""} onChange={(event) => set("dateRemitted", event.target.value)} /></div>
      </div>
      {startFields(`now ${account.start.nop} (${account.start.month})`)}
      <p className="text-xs text-muted-foreground">The receipt takes its place among the account&apos;s receipts by OR date. Leave the first NOP blank unless the account&apos;s numbering should start somewhere else, for example when the inserted receipt is the earliest one.</p>
      <ReceiptTable receipts={account.receipts} />
    </>}

    {tool === "merge" && <>
      <p className="text-sm">Kept: <strong>{member.member.number}</strong> {member.member.surname}, {member.member.firstName}{member.member.birthdate ? ` (born ${member.member.birthdate})` : ""}</p>
      <MemberPicker label="The duplicate to merge into it (removed afterwards)" exclude={member.member.id} onPick={(found) => { setOther(found); setPreview(null); }} />
      {other && <p className="text-sm">Duplicate: <strong>{other.number}</strong> {other.name}{other.birthdate ? ` (born ${other.birthdate})` : ""}</p>}
      {other && shared.length > 0 && <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Both have {shared.join(", ")}: those two accounts become one, with the receipts numbered again in OR-date order.</p>}
      {other && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={useOtherName} onChange={(event) => { setUseOtherName(event.target.checked); setPreview(null); }} />Use the duplicate&apos;s name ({other.name}) on the kept member</label>}
    </>}

    {tool === "split" && account && <>
      {accountSelect}
      <p className="text-sm font-medium">Tick the receipts that belong to the new member</p>
      <ReceiptTable receipts={account.receipts} tick={{ chosen, toggle }} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1"><Label htmlFor="sp-surname">New member surname</Label><Input id="sp-surname" value={form.surname ?? ""} onChange={(event) => set("surname", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sp-first">First name</Label><Input id="sp-first" value={form.firstName ?? ""} onChange={(event) => set("firstName", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sp-middle">Middle name</Label><Input id="sp-middle" value={form.middleName ?? ""} onChange={(event) => set("middleName", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sp-ext">Extension (Jr, Sr)</Label><Input id="sp-ext" value={form.nameExtension ?? ""} onChange={(event) => set("nameExtension", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sp-birth">Birthdate</Label><Input id="sp-birth" type="date" max={today()} value={form.birthdate ?? ""} onChange={(event) => set("birthdate", event.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="sp-doi">New member&apos;s DOI</Label><Input id="sp-doi" type="date" max={today()} value={form.newDoi ?? ""} onChange={(event) => set("newDoi", event.target.value)} /></div>
      </div>
      {startFields(`default: ${account.firstNop}, month after DOI`)}
      <div className="space-y-1 sm:w-80"><Label htmlFor="sp-keep">Correct {member.member.number}&apos;s first name (optional)</Label><Input id="sp-keep" placeholder={member.member.firstName} value={form.keepFirstName ?? ""} onChange={(event) => set("keepFirstName", event.target.value)} /></div>
    </>}

    <div className="flex flex-wrap items-center gap-3"><Button type="button" variant="outline" disabled={busy} onClick={() => void send(false)}>{busy && !preview ? "Working out..." : "Preview"}</Button>{message && <p role="status" className="text-sm">{message}</p>}</div>

    {preview && <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <p className="text-sm font-semibold">Preview: nothing is saved yet</p>
      <p className="text-sm">{preview.summary}</p>
      {preview.statuses.length > 0 && <ul className="text-sm">{preview.statuses.map((item) => <li key={item.account}>{item.program} {item.account}: status {item.before} → <strong>{item.after}</strong></li>)}</ul>}
      {preview.receipts.length > 0 && <div className="overflow-x-auto rounded-md border bg-background"><table className="w-full min-w-[620px] text-sm"><thead className="bg-muted/50 text-left"><tr><th className="p-2">OR</th><th className="p-2">OR date</th><th className="p-2 text-right">Amount</th><th className="p-2">Before</th><th className="p-2">After</th></tr></thead>
        <tbody>{preview.receipts.map((item) => <tr key={item.id} className="border-t"><td className="p-2 font-medium">{item.orNumber}</td><td className="p-2">{item.orDate}</td><td className="p-2 text-right">{peso(item.amount)}</td><td className="p-2 text-muted-foreground">{item.before}</td><td className="p-2 font-medium">{item.after}</td></tr>)}</tbody></table></div>}
      {preview.notes.map((note) => <p key={note} className="text-xs text-muted-foreground">{note}</p>)}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <div className="space-y-1"><Label htmlFor="fix-reason">Reason (required)</Label><Input id="fix-reason" maxLength={300} placeholder="e.g. Owner confirmed from the paper record: January is NOP 31" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <Button type="button" disabled={busy || reason.trim().length < 5} onClick={() => void send(true)}>{busy ? "Saving..." : "Save correction"}</Button>
      </div>
    </div>}
  </CardContent></Card>;
}

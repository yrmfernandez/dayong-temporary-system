"use client";

import { useCallback, useEffect, useState } from "react";
import { UserMinus } from "lucide-react";

import { confirmDialog, promptDialog } from "@/components/app-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDate, formatDateTime } from "@/lib/date-format";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Account = { enrollmentId: string; programId: string; programName: string; doi: string; branch: string; mas: string; accountStatus: string; pendingRequest: string };
type Found = { id: string; number: string; name: string; deceased: boolean; accounts: Account[] };
type Request = {
  id: string; branch: string; memberNumber: string; memberName: string; accounts: Array<{ enrollmentId: string; programName: string; accountStatus: string }>;
  reasonType: string; reason: string; diedOn: string; status: "Pending" | "Approved" | "Rejected"; requestedAt: string; requestedBy: string; reviewedBy: string; reviewedAt: string; reviewNote: string;
};
const REASONS = ["Dropped out", "Deceased", "Entered by mistake", "Other"];
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
const field = "h-9 w-full rounded-md border bg-background px-3 text-sm";

/**
 * Dropouts (owner, October 31, 2026; lib/dropouts.ts): an Entry Clerk searches a member, ticks the program(s) to drop
 * and gives the reason; an Administrator, HR Officer or IT approves or rejects it. Approved accounts are deactivated
 * that day: no more collections, and MAM stops counting them from the next month.
 */
export default function DropoutsPage() {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [member, setMember] = useState<Found | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [reasonType, setReasonType] = useState("");
  const [reason, setReason] = useState("");
  const [diedOn, setDiedOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [requests, setRequests] = useState<Request[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [listError, setListError] = useState("");

  const loadRequests = useCallback(async () => {
    try {
      const response = await fetch("/api/dropouts", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load dropouts.");
      setRequests(result.requests); setCanApprove(Boolean(result.canApprove)); setListError("");
    } catch (failure) { setListError(failure instanceof Error ? failure.message : "Unable to load dropouts."); }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the requests once on mount
  useEffect(() => { void loadRequests(); }, [loadRequests]);
  useLiveRefresh(["dropout_requests"], loadRequests);

  useEffect(() => {
    if (query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/dropouts?q=${encodeURIComponent(query.trim())}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json()).then((result) => setFound(result.members ?? [])).catch(() => undefined);
    }, 300);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query]);

  function pick(item: Found) {
    setMember(item); setQuery(""); setFound([]); setMessage("");
    setTicked(new Set(item.accounts.filter((account) => !account.pendingRequest).length === 1 ? item.accounts.filter((account) => !account.pendingRequest).map((account) => account.enrollmentId) : []));
    setReasonType(""); setReason(""); setDiedOn("");
  }
  const toggle = (id: string) => setTicked((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });

  async function submit() {
    if (!member) return;
    const names = member.accounts.filter((account) => ticked.has(account.enrollmentId)).map((account) => account.programName).join(", ");
    if (!await confirmDialog(`Ask to drop ${names} of ${member.name} (${member.number})? Nothing changes until an approver approves it.`)) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/dropouts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ memberId: member.id, enrollmentIds: [...ticked], reasonType, reason, diedOn: reasonType === "Deceased" ? diedOn : undefined }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to send the request.");
      setMessage(result.message); setMember(null); setTicked(new Set());
      void loadRequests();
    } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Unable to send the request."); }
    finally { setBusy(false); }
  }

  async function decide(request: Request, approve: boolean) {
    let note = "";
    if (approve) {
      if (!await confirmDialog(`Approve dropping ${request.accounts.map((account) => account.programName).join(", ")} of ${request.memberName}? The account(s) are deactivated today: no more collections, and MAM stops counting them from next month.${request.reasonType === "Deceased" ? " The member is also marked Deceased." : ""}`)) return;
    } else {
      note = (await promptDialog(`Why reject the dropout of ${request.memberName}? The clerk sees your note.`, { required: true }))?.trim() ?? "";
      if (!note) return;
    }
    const response = await fetch("/api/dropouts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, action: approve ? "approve" : "reject", note }) });
    const result = await response.json();
    setListError(response.ok && result.success ? "" : result.message || "Unable to decide it.");
    if (response.ok && result.success) { setMessage(result.message); void loadRequests(); }
  }

  const ready = member && ticked.size > 0 && reasonType && reason.trim().length >= 3 && (reasonType !== "Deceased" || diedOn);
  const pending = requests.filter((request) => request.status === "Pending");
  const decided = requests.filter((request) => request.status !== "Pending");

  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-2xl page-hero p-5">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-violet-95 p-3 text-violet-40"><UserMinus className="size-6" /></div>
        <div><h1 className="text-2xl font-bold">Dropouts</h1><p className="text-sm text-violet-30/80">Ask to drop a member&apos;s program: search the member, tick the program(s) and give the reason. An Administrator, HR Officer or IT approves it; then the account takes no more collections and MAM stops counting it from the next month.</p></div></div>
    </header>

    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Request a dropout</CardTitle></CardHeader><CardContent className="space-y-4">
      {!member ? <div className="space-y-2">
        <Label htmlFor="drop-search">Member</Label>
        <Input id="drop-search" placeholder="PH number or name (at least 2 letters)" value={query} onChange={(event) => { setQuery(event.target.value); if (event.target.value.trim().length < 2) setFound([]); }} />
        {query.trim().length >= 2 && (found.length ? <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">{found.map((item) => <li key={item.id}>
          <button type="button" className="w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => pick(item)}><strong>{item.name}</strong> <span className="text-muted-foreground">{item.number} · {item.accounts.map((account) => account.programName).join(", ")}</span></button>
        </li>)}</ul> : <p className="text-xs text-muted-foreground">No member with an active program in your branches matches.</p>)}
      </div> : <>
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">{member.name} <span className="font-normal text-muted-foreground">{member.number}</span>{member.deceased && <Badge variant="destructive" className="ml-2">Deceased</Badge>}</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => setMember(null)}>Choose another member</Button></div>
        <fieldset className="space-y-2"><legend className="text-sm font-medium">Program(s) to drop</legend>
          {member.accounts.map((account) => <label key={account.enrollmentId} className={`flex items-start gap-3 rounded-md border p-3 text-sm ${account.pendingRequest ? "opacity-60" : ""}`}>
            <input type="checkbox" className="mt-1" disabled={Boolean(account.pendingRequest)} checked={ticked.has(account.enrollmentId)} onChange={() => toggle(account.enrollmentId)} />
            <span><strong>{account.programName}</strong> · {account.accountStatus}<span className="block text-xs text-muted-foreground">DOI {formatDate(account.doi)} · {account.branch} · {account.mas}{account.pendingRequest ? ` · already in request ${account.pendingRequest}` : ""}</span></span>
          </label>)}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="drop-reason-type">Reason</Label>
            <select id="drop-reason-type" className={field} value={reasonType} onChange={(event) => setReasonType(event.target.value)}><option value="">Choose the reason</option>{REASONS.map((value) => <option key={value}>{value}</option>)}</select></div>
          {reasonType === "Deceased" && <div className="space-y-1"><Label htmlFor="drop-died">Date of death</Label><Input id="drop-died" type="date" max={today()} value={diedOn} onChange={(event) => setDiedOn(event.target.value)} /></div>}
        </div>
        <div className="space-y-1"><Label htmlFor="drop-reason">Details</Label><Input id="drop-reason" maxLength={300} placeholder="e.g. Member told the MAS on Oct 30 they will stop paying" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
        <Button type="button" disabled={!ready || busy} onClick={() => void submit()}>{busy ? "Sending..." : "Send for approval"}</Button>
      </>}
      {message && <p role="status" className="text-sm">{message}</p>}
    </CardContent></Card>

    {listError && <p role="alert" className="text-sm text-red-700">{listError}</p>}
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{canApprove ? "Waiting for your approval" : "Waiting for approval"} ({pending.length})</CardTitle></CardHeader><CardContent className="space-y-3">
      {pending.length ? pending.map((request) => <RequestCard key={request.id} request={request} actions={canApprove ? <>
        <Button type="button" size="sm" onClick={() => void decide(request, true)}>Approve</Button>
        <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => void decide(request, false)}>Reject</Button>
      </> : null} />) : <p className="text-sm text-muted-foreground">None.</p>}
    </CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Decided in the last 60 days</CardTitle></CardHeader><CardContent className="space-y-3">
      {decided.length ? decided.map((request) => <RequestCard key={request.id} request={request} />) : <p className="text-sm text-muted-foreground">None.</p>}
    </CardContent></Card>
  </section>;
}

function RequestCard({ request, actions }: { request: Request; actions?: React.ReactNode }) {
  const tone = request.status === "Approved" ? "default" : request.status === "Rejected" ? "destructive" : "secondary";
  return <div className="space-y-2 rounded-lg border p-3 text-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="font-semibold">{request.memberName} <span className="font-normal text-muted-foreground">{request.memberNumber} · {request.branch}</span></p>
      <Badge variant={tone}>{request.status}</Badge>
    </div>
    <p>{request.accounts.map((account) => `${account.programName} (${account.accountStatus})`).join(", ")}</p>
    <p><strong>{request.reasonType}</strong>{request.diedOn ? ` on ${formatDate(request.diedOn)}` : ""}: {request.reason}</p>
    <p className="text-xs text-muted-foreground">{request.id} · asked by {request.requestedBy || "—"} on {formatDateTime(request.requestedAt)}{request.reviewedBy ? ` · ${request.status.toLowerCase()} by ${request.reviewedBy} on ${formatDateTime(request.reviewedAt)}` : ""}</p>
    {request.reviewNote && <p className="text-destructive">Note: {request.reviewNote}</p>}
    {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
  </div>;
}

"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { InlineRow } from "@/components/inline-panel";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import { readApiResponse } from "@/lib/api-response";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { MemberMam } from "@/components/member-mam";
import { emptyDirectoryFilters, filterMemberDirectory, matchesStanding, MEMBER_STATUSES, STANDING_FILTERS, type DirectoryFilters, type DirectoryMember } from "@/lib/member-directory";

const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
const pageSize = 25;

export default function MembersPage() {
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [filters, setFilters] = useState({ ...emptyDirectoryFilters });
  // Links such as Exceptions open the directory already searched (?search=PH-123).
  useEffect(() => {
    const search = new URLSearchParams(window.location.search).get("search");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL after mount
    if (search) setFilters((current) => ({ ...current, search }));
  }, []);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name");
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<DirectoryMember | null>(null);
  const [busy, setBusy] = useState(true);
  const [statusWarning, setStatusWarning] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [canManage, setCanManage] = useState(false);
  // Administrators and HR Officers can move an enrollment to another employee in the same branch.
  const [canTransfer, setCanTransfer] = useState(false);
  // New members are added through New Sales, which only encoders can open.
  const [canAddMember, setCanAddMember] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [editing, setEditing] = useState<DirectoryMember | null>(null);
  // The member just saved, so the confirmation shows on that row.
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/members/directory", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load members.");
      setMembers(result.members); setStatusWarning(result.statusWarning || ""); setCanManage(Boolean(result.canManage)); setCanTransfer(Boolean(result.canTransfer)); setCanAddMember(Boolean(result.canAddMember)); setTransfers(result.transfers ?? []);
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load members."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision]);
  const filtered = filterMemberDirectory(members, filters).sort((a, b) => {
    const key = sort as "name" | "number" | "status";
    return (a[key].localeCompare(b[key], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (descending ? -1 : 1);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const enrollments = members.flatMap((member) => member.enrollments);
  function update(key: keyof DirectoryFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value })); setPage(1); setSelected(null);
  }
  const options: { key: Exclude<keyof DirectoryFilters, "search" | "standing">; label: string; values: [string, string][] }[] = [
    { key: "accountStatus", label: "Payment status (today)", values: ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Forfeited", "Suspended", "Needs review", "Not started"].map((v) => [v, v === "U" ? "U - Updated" : v === "ADV" ? "ADV - Advance" : v]) },
    { key: "branch", label: "Branch", values: unique(enrollments.map((e) => e.branch)).map((v) => [v, v]) },
    { key: "mas", label: "MAS / Collector", values: unique(enrollments.flatMap((e) => [e.mas, e.collector])).map((v) => [v, v]) },
    { key: "program", label: "Program", values: [...new Map(enrollments.map((e) => [e.programId, e.programName])).entries()].sort((a, b) => a[1].localeCompare(b[1])) },
    { key: "status", label: "Member status", values: unique(members.map((m) => m.status)).map((v): [string, string] => [v, v]) },
  ];
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Members</h1><p className="text-sm text-muted-foreground">Member master data. Each person appears once, with all their program enrollments.</p></div>
      <div className="flex gap-2">{canAddMember && <Link className={buttonVariants()} href="/new-sales">Add Member</Link>}<Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); setMembers([]); setSelected(null); setRevision((v) => v + 1); }}>Refresh</Button></div>
    </div>
    <div role="group" aria-label="Member standing" className="flex flex-wrap gap-2">
      {[["", "All"] as const, ...STANDING_FILTERS].map(([value, label]) => <Button key={value || "all"} type="button" size="sm" variant={filters.standing === value ? "default" : "outline"} aria-pressed={filters.standing === value} onClick={() => update("standing", value)}>{label}{!busy && <span className="ml-1.5 tabular-nums opacity-70">{value ? members.filter((member) => matchesStanding(member, value)).length : members.length}</span>}</Button>)}
    </div>
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search<input className={fieldClass} value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Name, PH number, contact number, address" /></label>
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>{[["name", "Member name"], ["number", "PH number"], ["status", "Member status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      {options.map(({ key, label, values }) => key === "branch" || key === "mas" || key === "program" ? <label key={key} className="text-sm">{label}<SearchSelect aria-label={label} className="mt-1 h-9" clearable placeholder="All" value={filters[key]} onValueChange={(value) => update(key, value)} options={values.map(([value, text]) => ({ value, label: text }))}/></label> : <label key={key} className="text-sm">{label}<select className={fieldClass} value={filters[key]} onChange={(e) => update(key, e.target.value)}><option value="">All</option>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setFilters({ ...emptyDirectoryFilters }); setPage(1); setSelected(null); }}>Reset filters</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Branch, MAS / Collector, program, and payment status filters match the same enrollment. The Collector is whoever brought in that program&apos;s latest Collector collection. Payment statuses use today&apos;s MAM calculations. View payment history in <Link className="underline" href="/mam">MAM</Link>.</p>
    {statusWarning && <p role="alert" className="text-amber-700">{statusWarning}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && !savedId && <p role="status" className="text-sm">{message}</p>}
    {busy ? <p role="status">Loading members...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{filtered.length} of {members.length} members</p>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["PH number", "Member", "Contact", "Location", "MAS", "Collector", "Member status", "Programs / Payment status", "Details"].map((label) => <th key={label} scope="col" className="whitespace-nowrap p-3">{label}</th>)}</tr></thead>
          <tbody>{visible.map((member) => <Fragment key={member.id}><tr className="border-t">
            <td className="p-3">{member.number || "-"}</td><td className="p-3 font-medium">{member.name || "Unnamed member"}</td><td className="p-3 whitespace-nowrap">{member.contact || "-"}</td>
            <td className="max-w-56 p-3">{member.address || "-"}<span className="block text-xs text-muted-foreground">{unique(member.enrollments.map((enrollment) => enrollment.branch)).join(", ")}</span></td>
            <td className="p-3">{unique(member.enrollments.map((enrollment) => enrollment.mas)).join(", ") || "-"}</td>
            <td className="p-3">{unique(member.enrollments.map((enrollment) => enrollment.collector)).join(", ") || "-"}</td>
            <td className="p-3"><span className="flex flex-col items-start gap-1"><StatusBadge status={member.deceased ? "Deceased" : member.status || "Not recorded"} tone={member.deceased ? "danger" : undefined} />{!member.deceased && <span className="text-xs text-muted-foreground">Alive</span>}</span></td>
            <td className="p-3">{member.enrollments.length ? <span className="flex flex-col items-start gap-1">{member.enrollments.map((e) => <span key={e.id} className="flex flex-wrap items-center gap-1"><span>{e.programName}: {e.accountStatus || "Needs review"}</span><StandingBadge enrollment={e} /></span>)}</span> : "No enrollments"}</td>
            <td className="p-3"><Button variant="outline" aria-expanded={selected?.id === member.id} aria-label={`View ${member.name}`} onClick={() => { setSavedId(""); setEditing(null); setSelected((current) => current?.id === member.id ? null : member); }}>{selected?.id === member.id ? "Collapse" : "View"}</Button></td>
          </tr>{savedId === member.id && !selected && message && <tr><td colSpan={9} className="px-3 pb-3"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p></td></tr>}{selected?.id === member.id && <InlineRow colSpan={9}><section aria-label="Member details" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected.name}</h2><div className="flex gap-2">{canManage && <Button variant={editing?.id === selected.id ? "default" : "outline"} aria-expanded={editing?.id === selected.id} onClick={() => setEditing((current) => current?.id === selected.id ? null : selected)}>{editing?.id === selected.id ? "Editing" : "Edit"}</Button>}{canManage && <Button variant="outline" className="text-destructive" onClick={async () => { if (!window.confirm(`Delete ${selected.name}?`)) return; setSavedId(""); const response = await fetch("/api/members/directory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member deleted." : result.message || "Unable to delete member."); if (response.ok) { setSelected(null); setRevision((value) => value + 1); } }}>Delete</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button></div></div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ["PH number", selected.number], ["Member status", selected.status], ["Alive / deceased", selected.deceased ? "Deceased" : "Alive"], ["Birthdate", selected.birthdate], ["Birthplace", selected.birthplace],
        ["Gender", selected.gender], ["Civil status", selected.civilStatus], ["Contact", selected.contact], ["Address", selected.address],
        ["Claimant", selected.claimant], ["Claimant contact", selected.claimantContact], ["Claimant address", selected.claimantAddress],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value || "Not recorded"}</dd></div>)}</dl>
      <h3 className="font-semibold">All program enrollments</h3>
      <EnrollmentTable enrollments={selected.enrollments} canTransfer={canTransfer} transfers={transfers} onTransferred={(enrollmentId, toMas) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, mas: toMas } : item) }); setRevision((value) => value + 1); }} />
      <MemberMam memberId={selected.id} />
</section>{editing?.id === member.id && <form className="mt-4 space-y-4 border-t pt-4" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/members/directory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, contact: form.get("contact"), status: form.get("status") }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member updated." : result.message || "Unable to update member."); if (response.ok) { setSavedId(editing.id); setEditing(null); setSelected(null); setRevision((value) => value + 1); } }}><div className="flex justify-between"><h2 className="font-semibold">Edit {editing.name}</h2><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Contact number<input name="contact" className={fieldClass} defaultValue={editing.contact}/></label><label className="text-sm">Member status<select name="status" required className={fieldClass} defaultValue={editing.status || "Active"}>{unique([...MEMBER_STATUSES, editing.status]).map((status) => <option key={status} value={status}>{status}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Choose Deceased when the member has died.</span></label></div><Button type="submit">Save member</Button></form>}</InlineRow>}</Fragment>)}{!visible.length && <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">{members.length ? "No members match these filters." : "No members recorded yet."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button type="button" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
    </>}
  </section>;
}

type Transfer = { enrollmentId: string; fromMas: string; toMas: string; reason: string; by: string; at: string };
type Enrollment = DirectoryMember["enrollments"][number];

/** A member's program enrollments; Administrators and HR Officers can move one to another employee in its branch. */
function EnrollmentTable({ enrollments, canTransfer, transfers, onTransferred }: { enrollments: Enrollment[]; canTransfer: boolean; transfers: Transfer[]; onTransferred: (enrollmentId: string, toMas: string) => void }) {
  const [open, setOpen] = useState("");
  const [candidates, setCandidates] = useState<Array<{ employeeId: string; name: string }>>([]);
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function start(enrollment: Enrollment) {
    setNote(""); setTarget(""); setReason("");
    if (open === enrollment.id) { setOpen(""); return; }
    setOpen(enrollment.id); setCandidates([]); setBusy(true);
    try {
      const response = await fetch(`/api/members/transfer?enrollmentId=${encodeURIComponent(enrollment.id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load employees.");
      setCandidates(result.candidates);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to load employees."); }
    finally { setBusy(false); }
  }
  async function transfer(enrollment: Enrollment) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrollmentId: enrollment.id, toEmployeeId: target, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to transfer.");
      setOpen(""); setNote(`${enrollment.programName} moved from ${result.transfer.fromMas} to ${result.transfer.toMas}. Future collections belong to ${result.transfer.toMas}.`);
      onTransferred(enrollment.id, result.transfer.toMas);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to transfer."); }
    finally { setBusy(false); }
  }
  const headers = ["Program", "DOI", "Branch", "MAS / Officer", "Collector", "Remittance method", "Enrollment status", "Payment status", ...(canTransfer ? [""] : [])];
  return <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead><tr>{headers.map((label, index) => <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
      <tbody>{enrollments.map((e) => {
        const last = transfers.find((item) => item.enrollmentId === e.id);
        return <Fragment key={e.id}>
          <tr className="border-t">
            <td className="p-2">{e.programName || "-"}</td><td className="p-2">{e.doi || "-"}</td><td className="p-2">{e.branch || "-"}</td>
            <td className="p-2">{e.mas || "-"}{last && <span className="block text-xs text-muted-foreground">Transferred from {last.fromMas}{last.at ? ` on ${last.at.slice(0, 10)}` : ""} · {last.reason}</span>}</td>
            <td className="p-2">{e.collector || "-"}</td><td className="p-2">{e.paymentMethod || "-"}</td><td className="p-2">{e.status || "-"}</td>
            <td className="p-2">{e.accountError || <span className="flex flex-wrap items-center gap-1">{e.accountStatus || "Needs review"}<StandingBadge enrollment={e} /></span>}</td>
            {canTransfer && <td className="p-2 text-right"><Button type="button" size="sm" variant={open === e.id ? "default" : "outline"} aria-expanded={open === e.id} onClick={() => void start(e)}>{open === e.id ? "Transferring" : "Transfer"}</Button></td>}
          </tr>
          {open === e.id && <InlineRow colSpan={headers.length}>
            <p className="text-sm font-semibold">Transfer {e.programName} from {e.mas || "no MAS"}</p>
            <p className="mb-3 text-xs text-muted-foreground">To another active employee in {e.branch}. Future collections belong to the new MAS; past collections and cash already owed stay with {e.mas || "the current MAS"}.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">New MAS / employee *<SearchSelect aria-label="New MAS" className="mt-1 h-9" placeholder={busy && !candidates.length ? "Loading..." : candidates.length ? "Search employee" : "No other employee in this branch"} disabled={!candidates.length} value={target} onValueChange={setTarget} options={candidates.map((item) => ({ value: item.employeeId, label: item.name, description: item.employeeId }))} /></label>
              <label className="text-sm">Reason *<Input className="mt-1 h-9" maxLength={300} value={reason} placeholder="e.g. Original MAS resigned; member requested a new officer" onChange={(event) => setReason(event.target.value)} /></label>
            </div>
            <div className="mt-3 flex gap-2"><Button type="button" disabled={busy || !target || reason.trim().length < 3} onClick={() => void transfer(e)}>{busy ? "Saving..." : "Transfer"}</Button><Button type="button" variant="ghost" onClick={() => setOpen("")}>Cancel</Button></div>
          </InlineRow>}
        </Fragment>;
      })}</tbody>
    </table>
    {!enrollments.length && <p className="p-2 text-sm">No program enrollments.</p>}
    {note && <p role="status" className="p-2 text-sm">{note}</p>}
  </div>;
}

/** Suspension and forfeiture stand out in the list, since both change what can be collected or sold. */
function StandingBadge({ enrollment }: { enrollment: { accountStatus?: string; temporarilySuspended?: boolean } }) {
  if (enrollment.accountStatus === "Forfeited") return <StatusBadge status="Forfeited" tone="danger" />;
  if (enrollment.temporarilySuspended) return <StatusBadge status="Temporarily suspended" tone="warning" />;
  return null;
}

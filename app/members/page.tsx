"use client";

import { confirmDialog } from "@/components/app-dialog";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { AdminDeletePanel } from "@/components/admin-delete";
import { MemberEditForm } from "@/components/member-edit-form";
import { InlineRow } from "@/components/inline-panel";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import { readApiResponse } from "@/lib/api-response";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { MemberMam } from "@/components/member-mam";
import { emptyDirectoryFilters, STANDING_FILTERS, type DirectoryFilters, type DirectoryMember } from "@/lib/member-directory";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { branchChoiceReady, branchesOutside, noBranchChoice, TransferBranchChoice, type BranchChoice } from "@/components/transfer-branch-choice";
import { manilaDateOf } from "@/lib/manila-date";

const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
type DirectoryOptions = { branches: string[]; mas: string[]; programs: [string, string][]; statuses: string[]; staff: Array<{ name: string; branches: string[] }> };

export default function MembersPage() {
  // One page of members; filtering, sorting and paging run on the server (app/api/members/directory).
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [totals, setTotals] = useState({ total: 0, matched: 0, pages: 1 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [choices, setChoices] = useState<DirectoryOptions>({ branches: [], mas: [], programs: [], statuses: [], staff: [] });
  const [filters, setFilters] = useState({ ...emptyDirectoryFilters });
  // The search box asks the server once typing pauses, not on every key.
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(filters.search), 350);
    return () => clearTimeout(timer);
  }, [filters.search]);
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
  // Administrators delete permanently, with every account, sale and collection (lib/admin-delete.ts).
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Administrators and HR Officers can move an enrollment to another employee in the same branch.
  const [canTransfer, setCanTransfer] = useState(false);
  const [canMoveProgram, setCanMoveProgram] = useState(false);
  // New members are added through New Sales, which only encoders can open.
  const [canAddMember, setCanAddMember] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [deactivations, setDeactivations] = useState<Record<string, Deactivation>>({});
  const [editing, setEditing] = useState<DirectoryMember | null>(null);
  // The member just saved, so the confirmation shows on that row.
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState("");
  const { branch, mas, program, status, accountStatus, standing } = filters;
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ search, branch, mas, program, status, accountStatus, standing, sort, order: descending ? "desc" : "asc", page: String(page) });
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows loading while this page of members arrives
    setBusy(true);
    fetch(`/api/members/directory?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load members.");
      setError(""); setMembers(result.members); setTotals({ total: result.total, matched: result.matched, pages: result.pages }); setCounts(result.counts ?? {}); setChoices(result.options);
      if (result.page !== page) setPage(result.page);
      setStatusWarning(result.statusWarning || ""); setCanManage(Boolean(result.canManage)); setCanDelete(Boolean(result.canDelete)); setCanTransfer(Boolean(result.canTransfer)); setCanMoveProgram(Boolean(result.canMoveProgram)); setCanAddMember(Boolean(result.canAddMember)); setTransfers(result.transfers ?? []); setDeactivations(result.deactivations ?? {});
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load members."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision, search, branch, mas, program, status, accountStatus, standing, sort, descending, page]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  useLiveRefresh(["members", "member_programs", "beneficiaries", "member_transfers"], () => { if (!editing) setRevision((value) => value + 1); }, 15000);
  const visible = members;
  const pages = totals.pages;
  const currentPage = page;
  function update(key: keyof DirectoryFilters, value: string) {
    // A new branch clears the MAS / Collector, which belongs to the branch.
    setFilters((previous) => ({ ...previous, [key]: value, ...(key === "branch" ? { mas: "" } : {}) })); setPage(1); setSelected(null);
  }
  const options: { key: Exclude<keyof DirectoryFilters, "search" | "standing">; label: string; values: [string, string][] }[] = [
    { key: "accountStatus", label: "Payment status (today)", values: ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Fully Paid", "Forfeited", "Suspended", "Needs review", "Not started"].map((v) => [v, v === "U" ? "U - Updated" : v === "ADV" ? "ADV - Advance" : v]) },
    { key: "branch", label: "Branch", values: choices.branches.map((v) => [v, v]) },
    // Branch first: only the employees assigned to the chosen branch.
    { key: "mas", label: "MAS / Collector", values: filters.branch ? choices.staff.filter((item) => item.branches.includes(filters.branch)).map((item): [string, string] => [item.name, item.name]).sort((a, b) => a[0].localeCompare(b[0])) : [] },
    { key: "program", label: "Program", values: choices.programs },
    { key: "status", label: "Member status", values: choices.statuses.map((v): [string, string] => [v, v]) },
  ];
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Members</h1><p className="text-sm text-muted-foreground">Member master data. Each person appears once, with all their program enrollments.</p></div>
      <div className="flex gap-2">{canAddMember && <Link className={buttonVariants()} href="/new-sales">Add Member</Link>}<Button variant="outline" disabled={busy} onClick={() => { setError(""); setSelected(null); setRevision((v) => v + 1); }}>Refresh</Button></div>
    </div>
    <div role="group" aria-label="Member standing" className="flex flex-wrap gap-2">
      {[["", "All"] as const, ...STANDING_FILTERS].map(([value, label]) => <Button key={value || "all"} type="button" size="sm" variant={filters.standing === value ? "default" : "outline"} aria-pressed={filters.standing === value} onClick={() => update("standing", value)}>{label}{counts[value] !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{counts[value]}</span>}</Button>)}
    </div>
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search<input className={fieldClass} value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Name, PH number, contact number, address" /></label>
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>{[["name", "Member name"], ["number", "PH number"], ["status", "Member status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      {options.map(({ key, label, values }) => key === "branch" || key === "mas" || key === "program" ? <label key={key} className="text-sm">{label}<SearchSelect aria-label={label} className="mt-1 h-9" clearable disabled={key === "mas" && !filters.branch} placeholder={key === "mas" && !filters.branch ? "Choose a branch first" : "All"} value={filters[key]} onValueChange={(value) => update(key, value)} options={values.map(([value, text]) => ({ value, label: text }))}/></label> : <label key={key} className="text-sm">{label}<select className={fieldClass} value={filters[key]} onChange={(e) => update(key, e.target.value)}><option value="">All</option>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setFilters({ ...emptyDirectoryFilters }); setPage(1); setSelected(null); }}>Reset filters</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Branch, MAS / Collector, program, and payment status filters match the same enrollment. The Collector is whoever brought in that program&apos;s latest Collector collection. Payment statuses use today&apos;s MAM calculations. View payment history in <Link className="underline" href="/mam">MAM</Link>.</p>
    {statusWarning && <p role="alert" className="text-amber-700">{statusWarning}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && !savedId && <p role="status" className="text-sm">{message}</p>}
    {busy && !members.length ? <p role="status">Loading members...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{busy ? "Updating... " : ""}{totals.matched} of {totals.total} members</p>
      <div className="overflow-x-auto rounded-xl border bg-background">
        {/* Seven columns that fit the page (October 11, 2026): the PH number and contact sit under the name, the Collector
            under the MAS; cells wrap instead of making the table scroll sideways. */}
        <table className="w-full text-left text-[13px] leading-snug"><thead className="bg-muted"><tr>{["Member", "DOI", "Location", "MAS / Collector", "Status", "Programs / Payment status", ""].map((label, index) => <th key={index} scope="col" className="px-2 py-2 align-bottom text-xs font-semibold">{label}</th>)}</tr></thead>
          <tbody>{visible.map((member) => <Fragment key={member.id}><tr className="border-t">
            <td className="px-2 py-2 align-top"><span className="block font-medium">{member.name || "Unnamed member"}</span><span className="block text-xs text-muted-foreground">{member.number || "-"}{member.contact ? ` · ${member.contact}` : ""}</span></td>
            {/* Each program account has its own DOI; with several programs, each is labeled with its program. */}
            <td className="px-2 py-2 align-top">{member.enrollments.length ? (member.enrollments.length === 1 ? <span className="whitespace-nowrap">{member.enrollments[0].doi || "-"}{member.enrollments[0].doiTime ? ` ${member.enrollments[0].doiTime}` : ""}</span> : <span className="flex flex-col gap-0.5">{member.enrollments.map((e) => <span key={e.id}><span className="whitespace-nowrap">{e.doi || "-"}{e.doiTime ? ` ${e.doiTime}` : ""}</span><span className="block text-xs text-muted-foreground">{e.programName}</span></span>)}</span>) : "-"}</td>
            <td className="px-2 py-2 align-top break-words">{member.address || "-"}<span className="block text-xs text-muted-foreground">{unique(member.enrollments.map((enrollment) => enrollment.branch)).join(", ")}</span></td>
            <td className="px-2 py-2 align-top">{unique(member.enrollments.map((enrollment) => enrollment.mas)).join(", ") || "-"}{unique(member.enrollments.map((enrollment) => enrollment.collector)).length > 0 && <span className="block text-xs text-muted-foreground">Collector: {unique(member.enrollments.map((enrollment) => enrollment.collector)).join(", ")}</span>}</td>
            <td className="px-2 py-2 align-top"><span className="flex flex-col items-start gap-1"><StatusBadge status={member.deceased ? "Deceased" : member.status || "Not recorded"} tone={member.deceased ? "danger" : undefined} />{!member.deceased && <span className="text-xs text-muted-foreground">Alive</span>}</span></td>
            <td className="px-2 py-2 align-top">{member.enrollments.length ? <span className="flex flex-col items-start gap-1">{member.enrollments.map((e) => <span key={e.id} className="flex flex-wrap items-center gap-1"><span>{e.programName}: {e.accountStatus || "Needs review"}</span><StandingBadge enrollment={e} /></span>)}</span> : "No enrollments"}</td>
            <td className="px-2 py-2 align-top text-right"><Button size="sm" variant="outline" aria-expanded={selected?.id === member.id} aria-label={`View ${member.name}`} onClick={() => { setSavedId(""); setEditing(null); setDeleting(false); setSelected((current) => current?.id === member.id ? null : member); }}>{selected?.id === member.id ? "Collapse" : "View"}</Button></td>
          </tr>{savedId === member.id && !selected && message && <tr><td colSpan={7} className="px-3 pb-3"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p></td></tr>}{selected?.id === member.id && <InlineRow colSpan={7}><section aria-label="Member details" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected.name}</h2><div className="flex gap-2">{canManage && <Button variant={editing?.id === selected.id ? "default" : "outline"} aria-expanded={editing?.id === selected.id} onClick={() => setEditing((current) => current?.id === selected.id ? null : selected)}>{editing?.id === selected.id ? "Editing" : "Edit"}</Button>}{canDelete && <Button variant={deleting ? "default" : "outline"} className={deleting ? "" : "text-destructive"} aria-expanded={deleting} onClick={() => setDeleting((value) => !value)}>Delete permanently</Button>}{canManage && !canDelete && <Button variant="outline" className="text-destructive" onClick={async () => { if (!await confirmDialog(`Delete ${selected.name}?`)) return; setSavedId(""); const response = await fetch("/api/members/directory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member deleted." : result.message || "Unable to delete member."); if (response.ok) { setSelected(null); setRevision((value) => value + 1); } }}>Delete</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button></div></div>
      {canDelete && deleting && <div className="rounded-lg border border-red-200 p-3 dark:border-red-900"><AdminDeletePanel kind="member" id={selected.id} onCancel={() => setDeleting(false)} onDeleted={(text) => { setDeleting(false); setSelected(null); setMessage(text); setRevision((value) => value + 1); }} /></div>}
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ["PH number", selected.number], ["Member status", selected.status], ["Alive / deceased", selected.deceased ? "Deceased" : "Alive"], ["Birthdate", selected.birthdate], ["Birthplace", selected.birthplace],
        ["Gender", selected.gender], ["Civil status", selected.civilStatus], ["Contact", selected.contact], ["Address", selected.address],
        ["Claimant", selected.claimant], ["Claimant contact", selected.claimantContact], ["Claimant address", selected.claimantAddress],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value || "Not recorded"}</dd></div>)}</dl>
      <h3 className="font-semibold">All program enrollments</h3>
      <EnrollmentTable enrollments={selected.enrollments} canTransfer={canTransfer} canMoveProgram={canMoveProgram} transfers={transfers} deactivations={deactivations}
        onStatusChanged={(enrollmentId, status) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, status, accountStatus: status === "Deactivated" ? "Deactivated" : item.accountStatus } : item) }); setRevision((value) => value + 1); }}
        onTransferred={(enrollmentId, toMas) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, mas: toMas } : item) }); setRevision((value) => value + 1); }}
        onBranchChanged={(enrollmentId, branch) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, branch } : item) }); setRevision((value) => value + 1); }}
        onProgramMoved={(enrollmentId, programId, programName, merged) => { setSelected((current) => current && { ...current, enrollments: merged ? current.enrollments.filter((item) => item.id !== enrollmentId) : current.enrollments.map((item) => item.id === enrollmentId ? { ...item, programId, programName } : item) }); setRevision((value) => value + 1); }} />
      <MemberMam memberId={selected.id} />
</section>{editing?.id === member.id && <MemberEditForm memberId={editing.id} onCancel={() => setEditing(null)} onSaved={(text) => { setMessage(text); setSavedId(editing.id); setEditing(null); setSelected(null); setRevision((value) => value + 1); }} />}</InlineRow>}</Fragment>)}{!visible.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{totals.total ? "No members match these filters." : "No members recorded yet."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button type="button" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
    </>}
  </section>;
}

type Mode = "mas" | "branch" | "program" | "status";
type Deactivation = { reason: string; by: string; at: string };
const deactivated = (status: string | undefined) => (status ?? "").trim().toLowerCase() === "deactivated";
type Transfer = { enrollmentId: string; fromMas: string; toMas: string; reason: string; by: string; at: string };
type Enrollment = DirectoryMember["enrollments"][number];

/**
 * A member's program enrollments. Transfer (owner, October 16, 2026: a choice of per MAS or per program): Administrators
 * and HR Officers move an account to another employee; Administrators and IT move it to another program with the same
 * monthly pay (lib/program-transfer.ts: merged into the member's account there if they have one, incentives follow).
 * To another branch (October 17, 2026): the same MAS keeps the account in a new branch (lib/member-transfer.ts
 * changeEnrollmentBranch), for those who may transfer.
 */
function EnrollmentTable({ enrollments, canTransfer, canMoveProgram, transfers, deactivations, onStatusChanged, onTransferred, onBranchChanged, onProgramMoved }: { enrollments: Enrollment[]; canTransfer: boolean; canMoveProgram: boolean; transfers: Transfer[];
  deactivations: Record<string, Deactivation>; onStatusChanged: (enrollmentId: string, status: string) => void; onTransferred: (enrollmentId: string, toMas: string) => void;
  onBranchChanged: (enrollmentId: string, branch: string) => void; onProgramMoved: (enrollmentId: string, programId: string, programName: string, merged: boolean) => void }) {
  const [open, setOpen] = useState("");
  const [mode, setMode] = useState<Mode>("mas");
  const [branchOptions, setBranchOptions] = useState<{ branches: string[]; masBranches: string[] }>({ branches: [], masBranches: [] });
  const [newBranch, setNewBranch] = useState("");
  const [programs, setPrograms] = useState<Array<{ id: string; name: string; code: string; rate: number }>>([]);
  const [targetProgram, setTargetProgram] = useState("");
  const [candidates, setCandidates] = useState<Array<{ employeeId: string; name: string; roles: string[]; branches: string[] }>>([]);
  const [target, setTarget] = useState("");
  const [branchChoice, setBranchChoice] = useState<BranchChoice>(noBranchChoice);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  async function start(enrollment: Enrollment) {
    setNote(""); setTarget(""); setReason(""); setBranchChoice(noBranchChoice); setTargetProgram(""); setNewBranch("");
    if (open === enrollment.id) { setOpen(""); return; }
    setOpen(enrollment.id); setCandidates([]); setPrograms([]); setBranchOptions({ branches: [], masBranches: [] });
    // A deactivated program can only be reactivated.
    const first: Mode = deactivated(enrollment.status) ? "status" : canTransfer ? "mas" : "program";
    setMode(first);
    await load(enrollment, first);
  }
  async function load(enrollment: Enrollment, which: Mode) {
    if (which === "status") { setNote(""); return; }
    setBusy(true); setNote("");
    if (which === "branch") {
      try {
        const response = await fetch(`/api/members/transfer?branches=1&enrollmentId=${encodeURIComponent(enrollment.id)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load branches.");
        setBranchOptions({ branches: result.branches, masBranches: result.masBranches });
      } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to load branches."); }
      finally { setBusy(false); }
      return;
    }
    if (which === "program") {
      try {
        const response = await fetch(`/api/programs/transfer?targets=1&program=${encodeURIComponent(enrollment.programId)}`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.success) throw new Error(result.message || "Unable to load programs.");
        setPrograms(result.targets);
      } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to load programs."); }
      finally { setBusy(false); }
      return;
    }
    try {
      const response = await fetch(`/api/members/transfer?enrollmentId=${encodeURIComponent(enrollment.id)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load employees.");
      setCandidates(result.candidates);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to load employees."); }
    finally { setBusy(false); }
  }
  async function moveProgram(enrollment: Enrollment) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/programs/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: enrollment.programId, to: targetProgram, enrollmentIds: [enrollment.id], reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to move the account.");
      if (result.left?.length) throw new Error(`Not moved: ${result.left.map((item: { why: string }) => item.why).join("; ")}`);
      const name = programs.find((item) => item.id === targetProgram)?.name ?? "";
      setOpen(""); setNote(result.message);
      onProgramMoved(enrollment.id, targetProgram, name, Boolean(result.merged));
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to move the account."); }
    finally { setBusy(false); }
  }
  async function transfer(enrollment: Enrollment) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrollmentId: enrollment.id, toEmployeeId: target, reason, ...branchChoice }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to transfer.");
      const { fromMas, toMas, assigned, movedBranch, moveTo } = result.transfer as { fromMas: string; toMas: string; assigned: string[]; movedBranch: number; moveTo: string };
      setOpen(""); setNote(`${enrollment.programName} moved from ${fromMas} to ${toMas}. Future collections belong to ${toMas}.${assigned.length ? ` ${toMas} is now assigned to ${assigned.join(", ")}.` : ""}${movedBranch ? ` The account moved to branch ${moveTo}.` : ""}`);
      onTransferred(enrollment.id, result.transfer.toMas);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to transfer."); }
    finally { setBusy(false); }
  }
  async function changeBranch(enrollment: Enrollment) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/members/transfer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "branch", enrollmentId: enrollment.id, branch: newBranch, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to change the branch.");
      const { from, to, mas, assigned } = result.change as { from: string[]; to: string; mas: string[]; assigned: string[] };
      setOpen(""); setNote(`${enrollment.programName} moved from branch ${from.join(", ")} to ${to}, still with ${mas.join(", ") || "no MAS"}. Future collections are recorded in ${to}.${assigned.length ? ` ${assigned.join(", ")} is now assigned to ${to}.` : ""}`);
      onBranchChanged(enrollment.id, to);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to change the branch."); }
    finally { setBusy(false); }
  }
  // Deactivate (owner, October 17, 2026): the member no longer has the program; history stays (lib/account-deactivation.ts).
  async function setActive(enrollment: Enrollment, active: boolean) {
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/members/account-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enrollmentId: enrollment.id, active, reason }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to change the program.");
      setOpen(""); setNote(active ? `${enrollment.programName} is active again for this member and takes collections.` : `${enrollment.programName} is deactivated for this member. Its New Sale and past collections stay in the history; it takes no more collections.`);
      onStatusChanged(enrollment.id, result.status);
    } catch (failure) { setNote(failure instanceof Error ? failure.message : "Unable to change the program."); }
    finally { setBusy(false); }
  }
  const canAct = canTransfer || canMoveProgram;
  const modesFor = (e: Enrollment) => (deactivated(e.status)
    ? ([["status", "Reactivate", canTransfer]] as const)
    : ([["mas", "To another MAS", canTransfer], ["branch", "To another branch (same MAS)", canTransfer], ["program", "To another program", canMoveProgram], ["status", "Deactivate this program", canTransfer]] as const)
  ).filter(([, , allowed]) => allowed);
  const masIsIn = (branch: string) => branchOptions.masBranches.some((item) => item.toLowerCase() === branch.toLowerCase());
  const headers = ["Program", "DOI", "Branch", "MAS / Officer", "Collector", "Remittance method", "Enrollment status", "Payment status", ...(canAct ? [""] : [])];
  return <div className="overflow-x-auto">
    <table className="w-full text-left text-sm">
      <thead><tr>{headers.map((label, index) => <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
      <tbody>{enrollments.map((e) => {
        const last = transfers.find((item) => item.enrollmentId === e.id);
        return <Fragment key={e.id}>
          <tr className="border-t">
            <td className="p-2">{e.programName || "-"}</td><td className="p-2">{e.doi || "-"}{e.doiTime ? <span className="block text-xs text-muted-foreground">{e.doiTime}</span> : null}</td><td className="p-2">{e.branch || "-"}</td>
            <td className="p-2">{e.mas || "-"}{last && <span className="block text-xs text-muted-foreground">Transferred from {last.fromMas}{last.at ? ` on ${manilaDateOf(last.at)}` : ""} · {last.reason}</span>}</td>
            <td className="p-2">{e.collector || "-"}</td><td className="p-2">{e.paymentMethod || "-"}</td>
            <td className="p-2">{deactivated(e.status) ? <><StatusBadge status="Deactivated" tone="danger" />{deactivations[e.id] && <span className="block text-xs text-muted-foreground">{deactivations[e.id].reason}{deactivations[e.id].by ? ` · ${deactivations[e.id].by}` : ""}{deactivations[e.id].at ? ` · ${manilaDateOf(deactivations[e.id].at)}` : ""}</span>}</> : e.status || "-"}</td>
            <td className="p-2">{deactivated(e.status) ? "—" : e.accountError || <span className="flex flex-wrap items-center gap-1">{e.accountStatus || "Needs review"}<StandingBadge enrollment={e} /></span>}</td>
            {canAct && <td className="p-2 text-right">{modesFor(e).length > 0 && <Button type="button" size="sm" variant={open === e.id ? "default" : "outline"} aria-expanded={open === e.id} onClick={() => void start(e)}>{deactivated(e.status) ? "Reactivate" : open === e.id ? "Changing" : "Transfer / deactivate"}</Button>}</td>}
          </tr>
          {open === e.id && <InlineRow colSpan={headers.length}>
            {modesFor(e).length > 1 && <div className="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Transfer to">
              {modesFor(e).map(([value, label]) => <Button key={value} type="button" size="sm" role="radio" aria-checked={mode === value} variant={mode === value ? "default" : "outline"} onClick={() => { if (mode !== value) { setMode(value); setReason(""); void load(e, value); } }}>{label}</Button>)}
            </div>}
            {mode === "status" ? <>
              <p className="text-sm font-semibold">{deactivated(e.status) ? `Reactivate ${e.programName} for this member` : `Deactivate ${e.programName} for this member`}</p>
              <p className="mb-3 text-xs text-muted-foreground">{deactivated(e.status)
                ? "The program becomes active again: it takes collections and shows in MAM, statuses and Follow Up, with its standing worked out from its payments."
                : "The member will no longer have this program: it takes no more collections and leaves MAM, payment statuses, Follow Up and account counts. Its New Sale and past collections stay in the reports and the member's history, and it can be reactivated later. Entries still waiting on a remittance must be settled first."}</p>
              <label className="block max-w-xl text-sm">Reason *<Input className="mt-1 h-9" maxLength={300} value={reason} placeholder={deactivated(e.status) ? "e.g. Member resumed paying" : "e.g. Member asked to drop this program"} onChange={(event) => setReason(event.target.value)} /></label>
              <div className="mt-3 flex gap-2"><Button type="button" variant={deactivated(e.status) ? "default" : "destructive"} disabled={busy || reason.trim().length < 3} onClick={() => void setActive(e, deactivated(e.status))}>{busy ? "Saving..." : deactivated(e.status) ? "Reactivate" : "Deactivate program"}</Button><Button type="button" variant="ghost" onClick={() => setOpen("")}>Cancel</Button></div>
            </> : mode === "branch" ? <>
              <p className="text-sm font-semibold">Move {e.programName} from branch {e.branch || "none"}, keeping {e.mas || "no MAS"}</p>
              <p className="mb-3 text-xs text-muted-foreground">Future collections are recorded in the new branch; past collections, the New Sale and cash already owed stay under {e.branch || "the current branch"}. The MAS stays the same.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">New branch *<SearchSelect aria-label="New branch" className="mt-1 h-9" placeholder={busy && !branchOptions.branches.length ? "Loading..." : "Search branch"} disabled={!branchOptions.branches.length} value={newBranch} onValueChange={setNewBranch} options={branchOptions.branches.map((name) => ({ value: name, label: name, description: masIsIn(name) ? `${e.mas} is assigned here` : "" }))} /></label>
                <label className="text-sm">Reason *<Input className="mt-1 h-9" maxLength={300} value={reason} placeholder="e.g. Member moved to another town; MAS covers both branches" onChange={(event) => setReason(event.target.value)} /></label>
              </div>
              {newBranch && e.mas && !masIsIn(newBranch) && <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{e.mas} is not assigned to {newBranch} yet and will be assigned to it, so collections and clearing work there.</p>}
              <div className="mt-3 flex gap-2"><Button type="button" disabled={busy || !newBranch || reason.trim().length < 3} onClick={() => void changeBranch(e)}>{busy ? "Saving..." : "Change branch"}</Button><Button type="button" variant="ghost" onClick={() => setOpen("")}>Cancel</Button></div>
            </> : mode === "program" ? <>
              <p className="text-sm font-semibold">Move {e.programName} to another program</p>
              <p className="mb-3 text-xs text-muted-foreground">Any program. With a different monthly pay, each receipt covers its amount ÷ the new monthly pay (it must work out in whole months) and the payments are numbered again by OR date. The account keeps its New Sale, collections and history; if this member already has an account in that program, the two are merged and their payments numbered in OR-date order. Incentives follow the new program.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm">New program *<SearchSelect aria-label="New program" className="mt-1 h-9" placeholder={busy && !programs.length ? "Loading..." : programs.length ? "Search program" : "No other program"} disabled={!programs.length} value={targetProgram} onValueChange={setTargetProgram} options={programs.map((item) => ({ value: item.id, label: item.name, description: `${item.code ? `${item.code} · ` : ""}₱${item.rate}/month`, keywords: item.code }))} /></label>
                <label className="text-sm">Reason *<Input className="mt-1 h-9" maxLength={300} value={reason} placeholder="e.g. Clerk chose D-350; the application form says DPB-350" onChange={(event) => setReason(event.target.value)} /></label>
              </div>
              <div className="mt-3 flex gap-2"><Button type="button" disabled={busy || !targetProgram || reason.trim().length < 3} onClick={() => void moveProgram(e)}>{busy ? "Saving..." : "Move to program"}</Button><Button type="button" variant="ghost" onClick={() => setOpen("")}>Cancel</Button></div>
            </> : <>
            <p className="text-sm font-semibold">Transfer {e.programName} from {e.mas || "no MAS"}</p>
            <p className="mb-3 text-xs text-muted-foreground">To another active employee of any branch. Future collections belong to the new MAS; past collections and cash already owed stay with {e.mas || "the current MAS"}.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">New MAS / employee *<SearchSelect aria-label="New MAS" className="mt-1 h-9" placeholder={busy && !candidates.length ? "Loading..." : candidates.length ? "Search employee, any branch" : "No other active employee"} disabled={!candidates.length} value={target} onValueChange={(value) => { setTarget(value); setBranchChoice(noBranchChoice); }} options={candidates.map((item) => ({ value: item.employeeId, label: item.name, description: `${item.employeeId} · ${item.branches.join(", ") || "No branch"}` }))} /></label>
              <label className="text-sm">Reason *<Input className="mt-1 h-9" maxLength={300} value={reason} placeholder="e.g. Original MAS resigned; member requested a new officer" onChange={(event) => setReason(event.target.value)} /></label>
            </div>
            {(() => { const chosen = candidates.find((item) => item.employeeId === target); return chosen && <div className="mt-3"><TransferBranchChoice name={chosen.name} outside={branchesOutside([e.branch], chosen.branches)} count={1} targetBranches={chosen.branches} value={branchChoice} onChange={setBranchChoice} /></div>; })()}
            <div className="mt-3 flex gap-2"><Button type="button" disabled={busy || !target || reason.trim().length < 3 || !branchChoiceReady(branchesOutside([e.branch], candidates.find((item) => item.employeeId === target)?.branches ?? []), branchChoice)} onClick={() => void transfer(e)}>{busy ? "Saving..." : "Transfer"}</Button><Button type="button" variant="ghost" onClick={() => setOpen("")}>Cancel</Button></div>
            </>}
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

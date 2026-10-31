"use client";

import { confirmDialog } from "@/components/app-dialog";
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { AdminDeletePanel } from "@/components/admin-delete";
import { MemberEditForm } from "@/components/member-edit-form";
import { InlineRow } from "@/components/inline-panel";
import { SearchSelect } from "@/components/ui/search-select";
import { Input } from "@/components/ui/input";
import { readApiResponse } from "@/lib/api-response";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { MemberMam } from "@/components/member-mam";
import { DATE_FILTERS, emptyDirectoryFilters, STANDING_FILTERS, type DirectoryFilters, type DirectoryMember } from "@/lib/member-directory";
import { useLiveRefresh } from "@/lib/use-live-refresh";
import { branchChoiceReady, branchesOutside, noBranchChoice, TransferBranchChoice, type BranchChoice } from "@/components/transfer-branch-choice";
import { formatDate as showDate } from "@/lib/date-format";

const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
/*
 * Phone layout (owner, October 31, 2026): below md each table row is a card and each cell a line, labeled from its
 * data-label; from md up it is the usual table. One set of rows, so the open member's details are not loaded twice.
 */
const stackTable = "block w-full md:table";
const stackHead = "hidden md:table-header-group";
const stackBody = "block md:table-row-group";
const stackRow = "block border-t px-3 py-2 md:table-row md:p-0";
const stackCell = "block py-0.5 md:table-cell md:align-top";
const labeled = "before:mr-2 before:text-xs before:font-medium before:text-muted-foreground before:content-[attr(data-label)] md:before:content-none";
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
  const liveReload = useRef(false);
  const [canManage, setCanManage] = useState(false);
  // Administrators delete permanently, with every account, sale and collection (lib/admin-delete.ts).
  const [canDelete, setCanDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Administrators and HR Officers can move an enrollment to another employee in the same branch.
  const [canTransfer, setCanTransfer] = useState(false);
  const [canMoveProgram, setCanMoveProgram] = useState(false);
  // New members are added through New Sales, which only encoders can open.
  const [canAddMember, setCanAddMember] = useState(false);
  // A MAS sees only their own members (lib/member-scope.ts): the page is My Members, without the MAS filter.
  const [ownOnly, setOwnOnly] = useState(false);
  // On a phone the filters fold away under the search box.
  const [showFilters, setShowFilters] = useState(false);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [deactivations, setDeactivations] = useState<Record<string, Deactivation>>({});
  const [editing, setEditing] = useState<DirectoryMember | null>(null);
  // The member just saved, so the confirmation shows on that row.
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState("");
  const { branch, mas, program, status, accountStatus, standing, dateField, dateFrom, dateTo } = filters;
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ search, branch, mas, program, status, accountStatus, standing, dateField, dateFrom, dateTo, sort, order: descending ? "desc" : "asc", page: String(page) });
    // A live update reads the directory again; paging and filters may use the server's copy from the last 15 s.
    if (liveReload.current) { query.set("fresh", "1"); liveReload.current = false; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- shows loading while this page of members arrives
    setBusy(true);
    fetch(`/api/members/directory?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load members.");
      // The open member's details follow the reload too (another user changed the name, an account...).
      setError(""); setMembers(result.members); setSelected((current) => current && (result.members.find((member: DirectoryMember) => member.id === current.id) ?? current)); setTotals({ total: result.total, matched: result.matched, pages: result.pages }); setCounts(result.counts ?? {}); setChoices(result.options);
      if (result.page !== page) setPage(result.page);
      setStatusWarning(result.statusWarning || ""); setCanManage(Boolean(result.canManage)); setCanDelete(Boolean(result.canDelete)); setCanTransfer(Boolean(result.canTransfer)); setCanMoveProgram(Boolean(result.canMoveProgram)); setCanAddMember(Boolean(result.canAddMember)); setOwnOnly(Boolean(result.ownOnly)); setTransfers(result.transfers ?? []); setDeactivations(result.deactivations ?? {});
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load members."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision, search, branch, mas, program, status, accountStatus, standing, dateField, dateFrom, dateTo, sort, descending, page]);
  // Live updates: reload when another user saves (lib/use-live-refresh.ts).
  // Not member_programs: a collection that changes an account's status writes there, so every collection saved anywhere
  // reloaded every open Members page (about 7.5 MB each, a large share of the Supabase egress; October 31, 2026).
  // Statuses are worked out when the page loads; a dropped or moved account shows on the next load or filter change.
  useLiveRefresh(["members", "beneficiaries", "member_transfers"], () => { if (!editing) { liveReload.current = true; setRevision((value) => value + 1); } }, 30000);
  const visible = members;
  const pages = totals.pages;
  const currentPage = page;
  function update(key: keyof DirectoryFilters, value: string) {
    // A new branch clears the MAS / Collector, which belongs to the branch.
    setFilters((previous) => ({ ...previous, [key]: value, ...(key === "branch" ? { mas: "" } : {}) })); setPage(1); setSelected(null);
  }
  const options: { key: Exclude<keyof DirectoryFilters, "search" | "standing" | "dateField" | "dateFrom" | "dateTo">; label: string; values: [string, string][] }[] = [
    { key: "accountStatus", label: "Payment status (today)", values: ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Fully Paid", "Forfeited", "Suspended", "Needs review", "Not started"].map((v) => [v, v === "U" ? "U - Updated" : v === "ADV" ? "ADV - Advance" : v]) },
    { key: "branch", label: "Branch", values: choices.branches.map((v) => [v, v]) },
    // Branch first: only the employees assigned to the chosen branch.
    ...(ownOnly ? [] : [{ key: "mas" as const, label: "MAS / Collector", values: filters.branch ? choices.staff.filter((item) => item.branches.includes(filters.branch)).map((item): [string, string] => [item.name, item.name]).sort((a, b) => a[0].localeCompare(b[0])) : [] }]),
    { key: "program", label: "Program", values: choices.programs },
    { key: "status", label: "Member status", values: choices.statuses.map((v): [string, string] => [v, v]) },
  ];
  return <section className="space-y-4 md:space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">{ownOnly ? "My Members" : "Members"}</h1><p className="text-sm text-muted-foreground">{ownOnly ? "Your members, each with all their programs. Tap View for details and payments." : "Member master data. Each person appears once, with all their program enrollments."}</p></div>
      <div className="flex gap-2">{canAddMember && <Link className={buttonVariants()} href="/new-sales">Add Member</Link>}<Button variant="outline" disabled={busy} onClick={() => { setError(""); setSelected(null); setRevision((v) => v + 1); }}>Refresh</Button></div>
    </div>
    <div role="group" aria-label="Member standing" className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
      {[["", "All"] as const, ...STANDING_FILTERS].map(([value, label]) => <Button key={value || "all"} type="button" size="sm" className="shrink-0" variant={filters.standing === value ? "default" : "outline"} aria-pressed={filters.standing === value} onClick={() => update("standing", value)}>{label}{counts[value] !== undefined && <span className="ml-1.5 tabular-nums opacity-70">{counts[value]}</span>}</Button>)}
    </div>
    <div className="flex items-end gap-2 sm:hidden">
      <label className="flex-1 text-sm">Search<input type="search" className={`${fieldClass} h-11 text-base`} value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Name, PH number, contact, address" /></label>
      <Button type="button" variant="outline" className="h-11" aria-expanded={showFilters} onClick={() => setShowFilters((value) => !value)}>{showFilters ? "Hide filters" : "Filters"}</Button>
    </div>
    <div className={`${showFilters ? "grid" : "hidden"} gap-3 rounded-xl border bg-background p-4 sm:grid sm:grid-cols-2 lg:grid-cols-4`}>
      <label className="hidden text-sm sm:block">Search<input className={fieldClass} value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Name, PH number, contact number, address" /></label>
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>{[["name", "Member name"], ["number", "PH number"], ["status", "Member status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      {options.map(({ key, label, values }) => key === "branch" || key === "mas" || key === "program" ? <label key={key} className="text-sm">{label}<SearchSelect aria-label={label} className="mt-1 h-9" clearable disabled={key === "mas" && !filters.branch} placeholder={key === "mas" && !filters.branch ? "Choose a branch first" : "All"} value={filters[key]} onValueChange={(value) => update(key, value)} options={values.map(([value, text]) => ({ value, label: text }))}/></label> : <label key={key} className="text-sm">{label}<select className={fieldClass} value={filters[key]} onChange={(e) => update(key, e.target.value)}><option value="">All</option>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      {/* Dates (owner, October 31, 2026): e.g. NS (DOI) in a date range; collections and receipts by date are in Search Records. */}
      <label className="text-sm">Date of<select className={fieldClass} value={filters.dateField} onChange={(e) => update("dateField", e.target.value)}><option value="">Any date</option>{DATE_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {filters.dateField && <div className="grid grid-cols-2 gap-2"><label className="text-sm">From<input type="date" className={fieldClass} value={filters.dateFrom} onChange={(e) => update("dateFrom", e.target.value)} /></label><label className="text-sm">To<input type="date" className={fieldClass} value={filters.dateTo} onChange={(e) => update("dateTo", e.target.value)} /></label></div>}
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setFilters({ ...emptyDirectoryFilters }); setPage(1); setSelected(null); }}>Reset filters</Button></div>
    </div>
    <p className="hidden text-sm text-muted-foreground md:block">Branch, MAS / Collector, program, and payment status filters match the same enrollment. The Collector is whoever brought in that program&apos;s latest Collector collection. Payment statuses use today&apos;s MAM calculations. View payment history in <Link className="underline" href="/mam">MAM</Link>.</p>
    {statusWarning && <p role="alert" className="text-amber-700">{statusWarning}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && !savedId && <p role="status" className="text-sm">{message}</p>}
    {busy && !members.length ? <p role="status">Loading members...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{busy ? "Updating... " : ""}{totals.matched} of {totals.total} members</p>
      <div className="overflow-hidden rounded-xl border bg-background md:overflow-x-auto">
        {/* Seven columns that fit the page (October 11, 2026): the PH number and contact sit under the name, the Collector
            under the MAS; cells wrap instead of making the table scroll sideways. */}
        <table className={`${stackTable} text-left text-[13px] leading-snug`}><thead className={`${stackHead} bg-muted`}><tr>{["Member", "DOI", "Location", "MAS / Collector", "Status", "Programs / Payment status", ""].map((label, index) => <th key={index} scope="col" className="px-2 py-2 align-bottom text-xs font-semibold">{label}</th>)}</tr></thead>
          <tbody className={stackBody}>{visible.map((member) => <Fragment key={member.id}><tr className={stackRow}>
            <td className={`${stackCell} md:px-2 md:py-2`}><span className="block text-base font-semibold md:text-[13px] md:font-medium">{member.name || "Unnamed member"}</span><span className="block text-xs text-muted-foreground">{member.number || "-"}{member.contact ? <> · <a className="underline md:no-underline" href={`tel:${member.contact.replace(/[^\d+]/g, "")}`}>{member.contact}</a></> : ""}</span></td>
            {/* Each program account has its own DOI; with several programs, each is labeled with its program. */}
            <td data-label="DOI" className={`${stackCell} ${labeled} md:px-2 md:py-2`}>{member.enrollments.length ? (member.enrollments.length === 1 ? <span className="whitespace-nowrap">{member.enrollments[0].doi || "-"}{member.enrollments[0].doiTime ? ` ${member.enrollments[0].doiTime}` : ""}</span> : <span className="flex flex-col gap-0.5">{member.enrollments.map((e) => <span key={e.id}><span className="whitespace-nowrap">{showDate(e.doi) || "-"}{e.doiTime ? ` ${e.doiTime}` : ""}</span><span className="block text-xs text-muted-foreground">{e.programName}</span></span>)}</span>) : "-"}</td>
            <td data-label="Location" className={`${stackCell} ${labeled} break-words md:px-2 md:py-2`}>{member.address || "-"}<span className="block text-xs text-muted-foreground">{unique(member.enrollments.map((enrollment) => enrollment.branch)).join(", ")}</span></td>
            <td data-label="MAS" className={`${stackCell} ${labeled} ${ownOnly ? "hidden md:table-cell" : ""} md:px-2 md:py-2`}>{unique(member.enrollments.map((enrollment) => enrollment.mas)).join(", ") || "-"}{unique(member.enrollments.map((enrollment) => enrollment.collector)).length > 0 && <span className="block text-xs text-muted-foreground">Collector: {unique(member.enrollments.map((enrollment) => enrollment.collector)).join(", ")}</span>}</td>
            <td data-label="Status" className={`${stackCell} ${labeled} md:px-2 md:py-2`}><span className="inline-flex flex-wrap items-center gap-1 md:flex md:flex-col md:items-start"><StatusBadge status={member.deceased ? "Deceased" : member.status || "Not recorded"} tone={member.deceased ? "danger" : undefined} />{!member.deceased && <span className="text-xs text-muted-foreground">Alive</span>}</span></td>
            <td data-label="Programs" className={`${stackCell} ${labeled} md:px-2 md:py-2`}>{member.enrollments.length ? <span className="mt-1 flex flex-col items-start gap-1 md:mt-0">{member.enrollments.map((e) => <span key={e.id} className="flex flex-wrap items-center gap-1"><span>{e.programName}: {e.accountStatus || "Needs review"}</span><StandingBadge enrollment={e} /></span>)}</span> : "No enrollments"}</td>
            <td className={`${stackCell} pt-2 md:px-2 md:py-2 md:text-right`}><Button size="sm" variant="outline" className="h-10 w-full md:h-7 md:w-auto" aria-expanded={selected?.id === member.id} aria-label={`View ${member.name}`} onClick={() => { setSavedId(""); setEditing(null); setDeleting(false); setSelected((current) => current?.id === member.id ? null : member); }}>{selected?.id === member.id ? "Collapse" : "View"}</Button></td>
          </tr>{savedId === member.id && !selected && message && <tr className="block md:table-row"><td colSpan={7} className="block px-3 pb-3 md:table-cell"><p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-700">{message}</p></td></tr>}{selected?.id === member.id && <InlineRow stack colSpan={7} className="p-3 md:p-4"><section aria-label="Member details" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected.name}</h2><div className="flex flex-wrap gap-2">{canManage && <Button variant={editing?.id === selected.id ? "default" : "outline"} aria-expanded={editing?.id === selected.id} onClick={() => setEditing((current) => current?.id === selected.id ? null : selected)}>{editing?.id === selected.id ? "Editing" : "Edit"}</Button>}{canDelete && <Button variant={deleting ? "default" : "outline"} className={deleting ? "" : "text-destructive"} aria-expanded={deleting} onClick={() => setDeleting((value) => !value)}>Delete permanently</Button>}{canManage && !canDelete && <Button variant="outline" className="text-destructive" onClick={async () => { if (!await confirmDialog(`Delete ${selected.name}?`)) return; setSavedId(""); const response = await fetch("/api/members/directory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member deleted." : result.message || "Unable to delete member."); if (response.ok) { setSelected(null); setRevision((value) => value + 1); } }}>Delete</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button></div></div>
      {canDelete && deleting && <div className="rounded-lg border border-red-200 p-3 dark:border-red-900"><AdminDeletePanel kind="member" id={selected.id} onCancel={() => setDeleting(false)} onDeleted={(text) => { setDeleting(false); setSelected(null); setMessage(text); setRevision((value) => value + 1); }} /></div>}
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ["PH number", selected.number], ["Member status", selected.status], ["Alive / deceased", selected.deceased ? "Deceased" : "Alive"], ["Birthdate", showDate(selected.birthdate)], ["Birthplace", selected.birthplace],
        ["Gender", selected.gender], ["Civil status", selected.civilStatus], ["Contact", selected.contact], ["Address", selected.address],
        ["Claimant", selected.claimant], ["Claimant contact", selected.claimantContact], ["Claimant address", selected.claimantAddress],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value || "Not recorded"}</dd></div>)}</dl>
      <h3 className="font-semibold">All program enrollments</h3>
      <EnrollmentTable enrollments={selected.enrollments} canDelete={canDelete} onDeleted={(enrollmentId, text) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.filter((item) => item.id !== enrollmentId) }); setMessage(text); setRevision((value) => value + 1); }} canTransfer={canTransfer} canMoveProgram={canMoveProgram} transfers={transfers} deactivations={deactivations}
        onStatusChanged={(enrollmentId, status) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, status, accountStatus: status === "Deactivated" ? "Deactivated" : item.accountStatus } : item) }); setRevision((value) => value + 1); }}
        onTransferred={(enrollmentId, toMas) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, mas: toMas } : item) }); setRevision((value) => value + 1); }}
        onBranchChanged={(enrollmentId, branch) => { setSelected((current) => current && { ...current, enrollments: current.enrollments.map((item) => item.id === enrollmentId ? { ...item, branch } : item) }); setRevision((value) => value + 1); }}
        onProgramMoved={(enrollmentId, programId, programName, merged) => { setSelected((current) => current && { ...current, enrollments: merged ? current.enrollments.filter((item) => item.id !== enrollmentId) : current.enrollments.map((item) => item.id === enrollmentId ? { ...item, programId, programName } : item) }); setRevision((value) => value + 1); }} />
      <MemberMam memberId={selected.id} />
</section>{editing?.id === member.id && <MemberEditForm memberId={editing.id} onCancel={() => setEditing(null)} onSaved={(text) => { setMessage(text); setSavedId(editing.id); setEditing(null); setSelected(null); setRevision((value) => value + 1); }} />}</InlineRow>}</Fragment>)}{!visible.length && <tr className="block md:table-row"><td colSpan={7} className="block p-8 text-center text-muted-foreground md:table-cell">{totals.total ? "No members match these filters." : "No members recorded yet."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-between gap-3 md:justify-end"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button type="button" variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
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
function EnrollmentTable({ enrollments, canDelete, onDeleted, canTransfer, canMoveProgram, transfers, deactivations, onStatusChanged, onTransferred, onBranchChanged, onProgramMoved }: { enrollments: Enrollment[]; canDelete: boolean; onDeleted: (enrollmentId: string, message: string) => void; canTransfer: boolean; canMoveProgram: boolean; transfers: Transfer[];
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
  const canAct = canTransfer || canMoveProgram || canDelete;
  const modesFor = (e: Enrollment) => (deactivated(e.status)
    ? ([["status", "Reactivate", canTransfer]] as const)
    : ([["mas", "To another MAS", canTransfer], ["branch", "To another branch (same MAS)", canTransfer], ["program", "To another program", canMoveProgram], ["status", "Deactivate this program", canTransfer]] as const)
  ).filter(([, , allowed]) => allowed);
  const masIsIn = (branch: string) => branchOptions.masBranches.some((item) => item.toLowerCase() === branch.toLowerCase());
  const headers = ["Program", "DOI", "Branch", "MAS / Officer", "Collector", "Remittance method", "Enrollment status", "Payment status", ...(canAct ? [""] : [])];
  const cell = `${stackCell} ${labeled} md:p-2`;
  return <div className="md:overflow-x-auto">
    <table className={`${stackTable} text-left text-sm`}>
      <thead className={stackHead}><tr>{headers.map((label, index) => <th key={index} scope="col" className="p-2">{label}</th>)}</tr></thead>
      <tbody className={stackBody}>{enrollments.map((e) => {
        const last = transfers.find((item) => item.enrollmentId === e.id);
        return <Fragment key={e.id}>
          <tr className={`${stackRow} rounded-lg border md:rounded-none md:border-x-0 md:border-b-0 mb-2 md:mb-0`}>
            <td className={`${stackCell} font-semibold md:p-2 md:font-normal`}>{e.programName || "-"}</td><td data-label="DOI" className={cell}>{showDate(e.doi) || "-"}{e.doiTime ? <span className="text-xs text-muted-foreground md:block"> {e.doiTime}</span> : null}</td><td data-label="Branch" className={cell}>{e.branch || "-"}</td>
            <td data-label="MAS" className={cell}>{e.mas || "-"}{last && <span className="block text-xs text-muted-foreground">Transferred from {last.fromMas}{last.at ? ` on ${showDate(last.at)}` : ""} · {last.reason}</span>}</td>
            <td data-label="Collector" className={cell}>{e.collector || "-"}</td><td data-label="Remittance" className={cell}>{e.paymentMethod || "-"}</td>
            <td data-label="Enrollment" className={cell}>{deactivated(e.status) ? <><StatusBadge status="Deactivated" tone="danger" />{deactivations[e.id] && <span className="block text-xs text-muted-foreground">{deactivations[e.id].reason}{deactivations[e.id].by ? ` · ${deactivations[e.id].by}` : ""}{deactivations[e.id].at ? ` · ${showDate(deactivations[e.id].at)}` : ""}</span>}</> : e.status || "-"}</td>
            <td data-label="Payment status" className={cell}>{deactivated(e.status) ? "—" : e.accountError || <span className="inline-flex flex-wrap items-center gap-1">{e.accountStatus || "Needs review"}<StandingBadge enrollment={e} /></span>}</td>
            {canAct && <td className={`${stackCell} pt-2 md:p-2 md:text-right`}><span className="inline-flex flex-wrap justify-end gap-1">{modesFor(e).length > 0 && <Button type="button" size="sm" variant={open === e.id ? "default" : "outline"} aria-expanded={open === e.id} onClick={() => void start(e)}>{deactivated(e.status) ? "Reactivate" : open === e.id ? "Changing" : "Transfer / deactivate"}</Button>}
              {/* An account entered by mistake (owner, October 28, 2026): once deactivated, Administrators delete it with a reason; the member stays. */}
              {canDelete && deactivated(e.status) && <Button type="button" size="sm" variant={open === `delete:${e.id}` ? "default" : "outline"} className={open === `delete:${e.id}` ? "" : "text-destructive"} aria-expanded={open === `delete:${e.id}`} onClick={() => setOpen((current) => current === `delete:${e.id}` ? "" : `delete:${e.id}`)}>Delete account</Button>}</span></td>}
          </tr>
          {open === `delete:${e.id}` && <InlineRow stack colSpan={headers.length}><div className="rounded-lg border border-red-200 p-3 dark:border-red-900"><AdminDeletePanel kind="account" id={e.id} onCancel={() => setOpen("")} onDeleted={(text) => { setOpen(""); onDeleted(e.id, text); }} /></div></InlineRow>}
          {open === e.id && <InlineRow stack colSpan={headers.length}>
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

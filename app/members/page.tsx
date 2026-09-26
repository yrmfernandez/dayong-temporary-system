"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readApiResponse } from "@/lib/api-response";
import { Button, buttonVariants } from "@/components/ui/button";
import { emptyDirectoryFilters, filterMemberDirectory, type DirectoryFilters, type DirectoryMember } from "@/lib/member-directory";

const fieldClass = "mt-1 block w-full rounded-md border bg-background p-2 text-sm";
const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
const pageSize = 25;

export default function MembersPage() {
  const [members, setMembers] = useState<DirectoryMember[]>([]);
  const [filters, setFilters] = useState({ ...emptyDirectoryFilters });
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("name");
  const [descending, setDescending] = useState(false);
  const [selected, setSelected] = useState<DirectoryMember | null>(null);
  const [busy, setBusy] = useState(true);
  const [statusWarning, setStatusWarning] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [canManage, setCanManage] = useState(false);
  const [editing, setEditing] = useState<DirectoryMember | null>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/members/directory", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load members.");
      setMembers(result.members); setStatusWarning(result.statusWarning || ""); setCanManage(Boolean(result.canManage));
    }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to load members."); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [revision]);
  const filtered = filterMemberDirectory(members, filters).sort((a, b) => {
    const key = sort as "name" | "number" | "city" | "province" | "status";
    return (a[key].localeCompare(b[key], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (descending ? -1 : 1);
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const enrollments = members.flatMap((member) => member.enrollments);
  function update(key: keyof DirectoryFilters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value })); setPage(1); setSelected(null);
  }
  const options: { key: Exclude<keyof DirectoryFilters, "search">; label: string; values: [string, string][] }[] = [
    { key: "accountStatus", label: "Payment status (today)", values: ["NS", "U", "ADV", "60D", "90D", "120D", "150D", "Forfeited", "Suspended", "Needs review", "Not started"].map((v) => [v, v === "U" ? "U - Updated" : v === "ADV" ? "ADV - Advance" : v]) },
    { key: "branch", label: "Branch", values: unique(enrollments.map((e) => e.branch)).map((v) => [v, v]) },
    { key: "mas", label: "MAS / Officer", values: unique(enrollments.map((e) => e.mas)).map((v) => [v, v]) },
    { key: "program", label: "Program", values: [...new Map(enrollments.map((e) => [e.programId, e.programName])).entries()].sort((a, b) => a[1].localeCompare(b[1])) },
    ...(["status", "province", "city"] as const).map((key) => ({ key, label: key === "status" ? "Member status" : key === "city" ? "City / Municipality" : "Province", values: unique(members.map((m) => m[key])).map((v): [string, string] => [v, v]) })),
  ];
  return <section className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Members</h1><p className="text-sm text-muted-foreground">Member master data. Each person appears once, with all their program enrollments.</p></div>
      <div className="flex gap-2"><Link className={buttonVariants()} href="/new-sales">Add Member</Link><Button variant="outline" disabled={busy} onClick={() => { setBusy(true); setError(""); setMembers([]); setSelected(null); setRevision((v) => v + 1); }}>Refresh</Button></div>
    </div>
    <div className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-4">
      <label className="text-sm">Search<input className={fieldClass} value={filters.search} onChange={(e) => update("search", e.target.value)} placeholder="Name, PH number, contact number" /></label>
      <label className="text-sm">Sort by<select className={fieldClass} value={sort} onChange={(e) => { setSort(e.target.value); setPage(1); }}>{[["name", "Member name"], ["number", "PH number"], ["city", "City / Municipality"], ["province", "Province"], ["status", "Member status"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm">Order<select className={fieldClass} value={descending ? "desc" : "asc"} onChange={(e) => { setDescending(e.target.value === "desc"); setPage(1); }}><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>
      {options.map(({ key, label, values }) => <label key={key} className="text-sm">{label}<select className={fieldClass} value={filters[key]} onChange={(e) => update(key, e.target.value)}><option value="">All</option>{values.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      <div className="flex items-end"><Button variant="ghost" onClick={() => { setFilters({ ...emptyDirectoryFilters }); setPage(1); setSelected(null); }}>Reset filters</Button></div>
    </div>
    <p className="text-sm text-muted-foreground">Branch, officer, program, and payment status filters match the same enrollment. Payment statuses use today&apos;s MAM calculations. View payment history in <Link className="underline" href="/mam">MAM</Link>.</p>
    {statusWarning && <p role="alert" className="text-amber-700">{statusWarning}</p>}
    {error && <p role="alert" className="text-red-600">{error}</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
    {busy ? <p role="status">Loading members...</p> : !error && <>
      <p className="text-sm" aria-live="polite">{filtered.length} of {members.length} members</p>
      <div className="overflow-x-auto rounded-xl border bg-background">
        <table className="w-full text-left text-sm"><thead className="bg-muted"><tr>{["PH number", "Member", "Contact", "Location", "Member status", "Programs / Payment status", "Details"].map((label) => <th key={label} scope="col" className="whitespace-nowrap p-3">{label}</th>)}</tr></thead>
          <tbody>{visible.map((member) => <tr key={member.id} className="border-t">
            <td className="p-3">{member.number || "-"}</td><td className="p-3 font-medium">{member.name || "Unnamed member"}</td><td className="p-3">{member.contact || "-"}</td>
            <td className="p-3">{[member.city, member.province].filter(Boolean).join(", ") || "-"}</td><td className="p-3">{member.status || "Not recorded"}</td>
            <td className="p-3">{member.enrollments.map((e) => `${e.programName}: ${e.accountStatus || "Needs review"}${e.temporarilySuspended ? " (temporarily suspended)" : ""}`).join(", ") || "No enrollments"}</td>
            <td className="p-3"><Button variant="outline" aria-label={`View ${member.name}`} onClick={() => setSelected(member)}>View</Button></td>
          </tr>)}{!visible.length && <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">{members.length ? "No members match these filters." : "No members recorded yet."}</td></tr>}</tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-3"><Button variant="outline" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm">Page {currentPage} of {pages}</span><Button variant="outline" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</Button></div>
    </>}
    {selected && <section aria-label="Member details" className="space-y-4 rounded-xl border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold">{selected.name}</h2><div className="flex gap-2">{canManage && <Button variant="outline" onClick={() => setEditing(selected)}>Edit</Button>}{canManage && <Button variant="outline" className="text-destructive" onClick={async () => { if (!window.confirm(`Delete ${selected.name}?`)) return; const response = await fetch("/api/members/directory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: selected.id }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member deleted." : result.message || "Unable to delete member."); if (response.ok) { setSelected(null); setRevision((value) => value + 1); } }}>Delete</Button>}<Button variant="ghost" onClick={() => setSelected(null)}>Close details</Button></div></div>
      <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">{[
        ["PH number", selected.number], ["Member status", selected.status], ["Birthdate", selected.birthdate], ["Birthplace", selected.birthplace],
        ["Gender", selected.gender], ["Civil status", selected.civilStatus], ["Contact", selected.contact], ["Address", selected.address],
        ["Claimant", selected.claimant], ["Claimant contact", selected.claimantContact], ["Claimant address", selected.claimantAddress],
      ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1">{value || "Not recorded"}</dd></div>)}</dl>
      <h3 className="font-semibold">All program enrollments</h3>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Program", "DOI", "Branch", "MAS / Officer", "Payment method", "Enrollment status", "Payment status"].map((label) => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead><tbody>{selected.enrollments.map((e) => <tr key={e.id} className="border-t">{[e.programName, e.doi, e.branch, e.mas, e.paymentMethod, e.status, e.accountError || `${e.accountStatus || "Needs review"}${e.temporarilySuspended ? " (temporarily suspended)" : ""}`].map((v, i) => <td key={i} className="p-2">{v || "-"}</td>)}</tr>)}</tbody></table>{!selected.enrollments.length && <p className="p-2 text-sm">No program enrollments.</p>}</div>
      <Link className="text-sm underline" href="/mam">Open Member Account Monitoring</Link>
    </section>}
    {editing && <form className="space-y-4 rounded-xl border bg-background p-5" onSubmit={async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const response = await fetch("/api/members/directory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing.id, contact: form.get("contact"), status: form.get("status") }) }); const result = await readApiResponse(response); setMessage(response.ok && result.success ? "Member updated." : result.message || "Unable to update member."); if (response.ok) { setEditing(null); setSelected(null); setRevision((value) => value + 1); } }}><div className="flex justify-between"><h2 className="font-semibold">Edit {editing.name}</h2><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Contact number<input name="contact" className={fieldClass} defaultValue={editing.contact}/></label><label className="text-sm">Member status<input name="status" required className={fieldClass} defaultValue={editing.status}/></label></div><Button>Save member</Button></form>}
  </section>;
}

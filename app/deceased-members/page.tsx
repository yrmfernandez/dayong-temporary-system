"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Download, FileText, Flower2, ImageIcon, Paperclip, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Upload, Users, X } from "lucide-react";

import { confirmDialog, promptDialog } from "@/components/app-dialog";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { Textarea } from "@/components/ui/textarea";
import { parseJsonResponse } from "@/lib/api-response";
import { formatDate } from "@/lib/date-format";
import {
  DECEASED_FILE_ACCEPT, DECEASED_FILE_TYPES, listWithOther, MAX_DECEASED_FILE_BYTES, missingRequirements, serviceLabel,
  type DeceasedFile, type DeceasedRecord,
} from "@/lib/deceased-members-rules";
import { formatPeso } from "@/lib/money";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Option = { id: string; name: string };
type Data = {
  success: boolean; message?: string; view: "mine" | "all"; canOversee: boolean; today: string; records: DeceasedRecord[];
  branches: string[]; primaryBranch: string; mas: Record<string, Option[]>; programs: Array<Option & { active: boolean }>;
  requirements: string[]; claims: string[]; services: string[];
};
type MemberChoice = { id: string; number: string; name: string; programIds: string[]; statuses: string[] };
type Draft = {
  branch: string; masEmployeeId: string; masName: string; memberId: string; deceasedName: string; programId: string;
  convertedToServices: "" | "yes" | "no"; nop: string; totalMonthlyDeposit: string; dateOfDeath: string;
  requirements: string[]; requirementsOther: string; claims: string[]; claimsOther: string;
  service: string; serviceOther: string; fullPaymentAmount: string; dateOfRelease: string; remarks: string;
};
type Say = (ok: boolean, text: string) => void;

const field = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const OTHER = "Other";
const OTHER_MAS = "__other_mas__";
const csvCell = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
const sizeLabel = (bytes: number) => bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`;
const fileUrl = (id: string, download = false) => `/api/deceased-members/files?id=${encodeURIComponent(id)}${download ? "&download=1" : ""}`;

const emptyDraft = (branch: string): Draft => ({
  branch, masEmployeeId: "", masName: "", memberId: "", deceasedName: "", programId: "", convertedToServices: "", nop: "", totalMonthlyDeposit: "", dateOfDeath: "",
  requirements: [], requirementsOther: "", claims: [], claimsOther: "", service: "", serviceOther: "", fullPaymentAmount: "", dateOfRelease: "", remarks: "",
});
const draftOf = (record: DeceasedRecord): Draft => ({
  branch: record.branch, masEmployeeId: record.masEmployeeId, masName: record.masName, memberId: record.memberId, deceasedName: record.deceasedName, programId: record.programId,
  convertedToServices: record.convertedToServices ? "yes" : "no", nop: record.nop === null ? "" : String(record.nop),
  totalMonthlyDeposit: record.totalMonthlyDeposit === null ? "" : String(record.totalMonthlyDeposit), dateOfDeath: record.dateOfDeath,
  requirements: [...record.requirements, ...(record.requirementsOther ? [OTHER] : [])], requirementsOther: record.requirementsOther,
  claims: [...record.claims, ...(record.claimsOther ? [OTHER] : [])], claimsOther: record.claimsOther,
  service: record.service, serviceOther: record.serviceOther, fullPaymentAmount: record.fullPaymentAmount === null ? "" : String(record.fullPaymentAmount),
  dateOfRelease: record.dateOfRelease, remarks: record.remarks,
});

async function sendJson(method: "POST" | "PATCH", body: Record<string, unknown>) {
  const response = await fetch("/api/deceased-members", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await parseJsonResponse<{ success: boolean; message?: string; record?: DeceasedRecord }>(response);
  return { ok: response.ok && result.success, message: result.message ?? (response.ok ? "Saved." : "Unable to save."), record: result.record };
}

/**
 * A photo over 1.5 MB is redrawn at most 2,000 px wide or tall as a JPEG, in colour, so certificates stay readable and
 * the upload stays under the 4 MB limit. Other files (PDF, Word, Excel, HEIC the browser cannot draw) go as they are.
 */
async function shrinkIfPhoto(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 1_500_000) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch { return file; }
}

/** Sends the files one at a time; returns the record as it is after the last one, and the files that failed. */
async function uploadFiles(claimId: string, list: File[], onProgress: (done: number) => void) {
  let record: DeceasedRecord | undefined; const failed: string[] = [];
  for (const [index, original] of list.entries()) {
    const file = await shrinkIfPhoto(original);
    const form = new FormData(); form.append("claimId", claimId); form.append("file", file, file.name);
    try {
      const response = await fetch("/api/deceased-members/files", { method: "POST", body: form });
      const result = await parseJsonResponse<{ success: boolean; message?: string; record?: DeceasedRecord }>(response);
      if (response.ok && result.success) record = result.record; else failed.push(result.message || `${original.name} was not attached.`);
    } catch { failed.push(`${original.name} was not attached: the connection dropped.`); }
    onProgress(index + 1);
  }
  return { record, failed };
}

/**
 * Deceased Members (owner, November 26, 2026; lib/deceased-members.ts). Entry Clerks encode each deceased member with the
 * requirements handed in, the claims given, services and files; Administrators and Finance see every record.
 */
export default function DeceasedMembersPage() {
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<"mine" | "all">("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(0);

  const load = useCallback(async () => {
    if (busyRef.current > 0) return; // a save or upload is on its way; it reloads when done
    setLoading(true);
    try {
      const response = await fetch(`/api/deceased-members?view=${view}${showRemoved ? "&removed=1" : ""}`, { cache: "no-store" });
      const result = await parseJsonResponse<Data>(response);
      if (!response.ok || !result.success) { setNotice({ ok: false, text: result.message || "Unable to load Deceased Members." }); return; }
      setData(result);
    } finally { setLoading(false); }
  }, [view, showRemoved]);
  useEffect(() => { void load(); }, [load]);
  useLiveRefresh(["deceased_claims", "deceased_claim_files"], load);

  const say: Say = (ok, text) => setNotice({ ok, text });
  const mode = data?.view ?? view;
  const encodes = Boolean(data && (data.branches.length > 0 || !data.canOversee));

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-3 rounded-3xl page-hero p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-95 p-3 text-violet-40"><Flower2 className="size-6" /></div>
        <div>
          <h1 className="text-2xl font-bold">Deceased Members</h1>
          <p className="text-sm text-violet-30/80">{mode === "all"
            ? "Every deceased member encoded by the Entry Clerks: requirements, claims, services and attached files. View only: each clerk keeps their own records."
            : "Encode each deceased member: the program, the requirements handed in, the claims given or the services, and attach the documents."}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {data?.canOversee && encodes && <div className="inline-flex rounded-lg border bg-background p-0.5" role="tablist" aria-label="Whose records">
          {(["all", "mine"] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={view === option}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setView(option)}>{option === "all" ? "Every clerk" : "My records"}</button>)}
        </div>}
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
    </header>

    {notice && <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"}`} role="status">
      <span className="whitespace-pre-line">{notice.text}</span>
      <button type="button" aria-label="Close" onClick={() => setNotice(null)}><X className="size-4" /></button>
    </div>}

    {!data ? <p className="p-6 text-sm text-muted-foreground">Loading Deceased Members...</p>
      : mode === "all"
        ? <Overview data={data} showRemoved={showRemoved} setShowRemoved={setShowRemoved} />
        : <MyRecords data={data} showRemoved={showRemoved} setShowRemoved={setShowRemoved} say={say} reload={load} busyRef={busyRef} />}
  </section>;
}

// ---------------------------------------------------------------- the clerk's records

function MyRecords({ data, showRemoved, setShowRemoved, say, reload, busyRef }: {
  data: Data; showRemoved: boolean; setShowRemoved: (value: boolean) => void; say: Say; reload: () => Promise<void>; busyRef: { current: number };
}) {
  const [editing, setEditing] = useState<DeceasedRecord | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const query = search.trim().toLowerCase();
  const shown = data.records.filter((record) => (!branch || record.branch === branch)
    && (!query || `${record.deceasedName} ${record.programName} ${record.masName} ${record.remarks}`.toLowerCase().includes(query)));
  const formRef = useRef<HTMLDivElement>(null);
  const open = (target: DeceasedRecord | "new") => { setEditing(target); requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })); };

  async function remove(record: DeceasedRecord) {
    const reason = await promptDialog(`Remove the record of ${record.deceasedName}? Say why (it is kept and can be restored).`, { placeholder: "Encoded twice, wrong person..." });
    if (reason === null) return;
    const result = await sendJson("PATCH", { action: "remove", id: record.id, reason });
    say(result.ok, result.message); if (result.ok) await reload();
  }
  async function restore(record: DeceasedRecord) {
    const result = await sendJson("PATCH", { action: "restore", id: record.id });
    say(result.ok, result.message); if (result.ok) await reload();
  }

  if (!data.branches.length) return <Card><CardContent className="py-6 text-sm text-muted-foreground">You have no branch yet, so you cannot encode deceased members. Ask an administrator to set your branch in Employees.</CardContent></Card>;

  return <div className="space-y-6">
    <div ref={formRef} className="scroll-mt-24">
      {editing
        ? <RecordForm key={editing === "new" ? "new" : editing.id} data={data} record={editing === "new" ? null : editing} say={say} busyRef={busyRef}
          onDone={async () => { setEditing(null); await reload(); }} onCancel={() => setEditing(null)} />
        : <Button type="button" onClick={() => open("new")}><Plus className="mr-2 size-4" />Encode a deceased member</Button>}
    </div>

    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>My records <span className="font-normal text-muted-foreground">({shown.length})</span></CardTitle>
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />Show removed</label>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-9 pl-8" placeholder="Search name, program, MAS, remarks" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search records" /></div>
          {data.branches.length > 1 && <select className={`${field} w-auto`} value={branch} onChange={(event) => setBranch(event.target.value)} aria-label="Branch"><option value="">All my branches</option>{data.branches.map((name) => <option key={name}>{name}</option>)}</select>}
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {!data.records.length ? <p className="py-6 text-center text-sm text-muted-foreground">No deceased member encoded yet. Use Encode a deceased member above.</p>
          : !shown.length ? <p className="py-6 text-center text-sm text-muted-foreground">No record matches the search.</p>
            : shown.map((record) => <RecordRow key={record.id} record={record} showBranch={data.branches.length > 1}
              actions={record.status === "Removed"
                ? <Button type="button" size="sm" variant="outline" onClick={() => void restore(record)}><RotateCcw className="mr-2 size-4" />Restore</Button>
                : <>
                  <Button type="button" size="sm" variant="outline" onClick={() => open(record)}><Pencil className="mr-2 size-4" />Edit</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => void remove(record)}><Trash2 className="mr-2 size-4" />Remove</Button>
                </>} />)}
      </CardContent>
    </Card>
  </div>;
}

// ---------------------------------------------------------------- the form

function RecordForm({ data, record, say, busyRef, onDone, onCancel }: {
  data: Data; record: DeceasedRecord | null; say: Say; busyRef: { current: number }; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => record ? draftOf(record) : emptyDraft(data.primaryBranch || data.branches[0] || ""));
  const [files, setFiles] = useState<DeceasedFile[]>(record?.files ?? []);
  const [queued, setQueued] = useState<File[]>([]);
  const [busy, setBusy] = useState("");
  // The member list, kept with the branch and MAS it was loaded for, so a change of either shows no stale names.
  const [loaded, setLoaded] = useState<{ key: string; members: MemberChoice[] }>({ key: "", members: [] });
  const membersKey = draft.branch && draft.masName.trim() ? `${draft.branch}|${draft.masName.trim().toLowerCase()}` : "";
  const members = useMemo(() => loaded.key === membersKey ? loaded.members : [], [loaded, membersKey]);
  const membersLoading = Boolean(membersKey) && loaded.key !== membersKey;
  const [typingName, setTypingName] = useState(Boolean(record && !record.memberId));
  const masList = useMemo(() => data.mas[draft.branch] ?? [], [data.mas, draft.branch]);
  const [otherMas, setOtherMas] = useState(Boolean(record && !record.masEmployeeId && record.masName));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  // The members with an account under the chosen branch and MAS (any status), for the member field.
  // A typed MAS name waits until typing stops.
  useEffect(() => {
    if (!membersKey) return;
    const controller = new AbortController();
    const [branch, mas] = [draft.branch, draft.masName.trim()];
    const timer = setTimeout(() => {
      fetch(`/api/deceased-members?members=1&branch=${encodeURIComponent(branch)}&mas=${encodeURIComponent(mas)}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.json())
        .then((result) => setLoaded({ key: membersKey, members: result.success ? result.members ?? [] : [] }))
        .catch(() => { if (!controller.signal.aborted) setLoaded({ key: membersKey, members: [] }); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- membersKey already holds the branch and MAS
  }, [membersKey]);

  const member = members.find((item) => item.id === draft.memberId);
  // A picked member's programs come first; every program stays choosable.
  const programs = useMemo(() => {
    const theirs = new Set(member?.programIds ?? []);
    return [...data.programs].sort((a, b) => Number(theirs.has(b.id)) - Number(theirs.has(a.id)));
  }, [data.programs, member]);

  function pickMember(id: string) {
    const picked = members.find((item) => item.id === id);
    setDraft((current) => ({ ...current, memberId: id, deceasedName: picked?.name ?? "", programId: picked?.programIds.length === 1 ? picked.programIds[0] : picked?.programIds.includes(current.programId) ? current.programId : "" }));
  }
  function pickMas(value: string) {
    if (value === OTHER_MAS) { setOtherMas(true); setDraft((current) => ({ ...current, masEmployeeId: "", masName: "", memberId: "" })); return; }
    const mas = masList.find((item) => item.id === value);
    setDraft((current) => ({ ...current, masEmployeeId: mas?.id ?? "", masName: mas?.name ?? "", memberId: "" }));
  }
  function toggle(key: "requirements" | "claims", item: string) {
    setDraft((current) => ({ ...current, [key]: current[key].includes(item) ? current[key].filter((value) => value !== item) : [...current[key], item] }));
  }
  function addFiles(list: FileList | null) {
    const picked = [...(list ?? [])];
    const refused = picked.filter((file) => !DECEASED_FILE_TYPES[file.type] && !/\.(pdf|docx?|xlsx?|jpe?g|png|webp|heic|heif)$/i.test(file.name));
    const tooBig = picked.filter((file) => file.size > MAX_DECEASED_FILE_BYTES && !/^image\/(jpeg|png|webp)$/.test(file.type));
    const ok = picked.filter((file) => !refused.includes(file) && !tooBig.includes(file));
    setQueued((current) => [...current, ...ok]);
    const problems = [...refused.map((file) => `${file.name}: use a photo, PDF, Word or Excel file.`), ...tooBig.map((file) => `${file.name} is over 4 MB.`)];
    if (problems.length) say(false, problems.join("\n"));
  }
  async function removeFile(file: DeceasedFile) {
    if (!(await confirmDialog(`Remove ${file.name} from this record?`))) return;
    const response = await fetch("/api/deceased-members/files", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: file.id }) });
    const result = await parseJsonResponse<{ success: boolean; message?: string; record?: DeceasedRecord }>(response);
    say(response.ok && result.success, result.message || "Unable to remove the file.");
    if (result.record) setFiles(result.record.files);
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    // While saving and attaching, live updates do not reload the list; it reloads once at the end.
    busyRef.current += 1;
    setBusy("Saving...");
    let saved = false;
    try {
      const result = record ? await sendJson("PATCH", { action: "update", id: record.id, ...draft }) : await sendJson("POST", { ...draft });
      if (!result.ok || !result.record) { say(false, result.message); return; }
      saved = true;
      const { failed } = queued.length ? await uploadFiles(result.record.id, queued, (done) => setBusy(`Attaching files... ${done} of ${queued.length}`)) : { failed: [] as string[] };
      const attached = queued.length - failed.length;
      say(!failed.length, failed.length
        ? `${result.message} ${attached ? `${attached} file${attached === 1 ? "" : "s"} attached, but ` : ""}some files were not; open Edit to attach them again:\n${failed.join("\n")}`
        : `${result.message}${attached ? ` ${attached} file${attached === 1 ? "" : "s"} attached.` : ""}`);
    } finally {
      busyRef.current = Math.max(0, busyRef.current - 1);
      setBusy("");
    }
    if (saved) await onDone();
  }

  const converted = draft.convertedToServices === "yes";
  return <Card className="duration-200 animate-in fade-in-0 slide-in-from-top-1">
    <CardHeader className="border-b"><div className="flex items-center justify-between gap-2">
      <CardTitle>{record ? `Edit: ${record.deceasedName}` : "Encode a deceased member"}</CardTitle>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={Boolean(busy)}><X className="mr-1 size-4" />Close</Button>
    </div></CardHeader>
    <CardContent className="pt-4">
      <form onSubmit={(event) => void save(event)} className="space-y-6">
        <FormSection title="Member">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1 md:col-span-3">
              <Label htmlFor="dm-branch">Branch</Label>
              {data.branches.length > 1
                ? <select id="dm-branch" className={field} value={draft.branch} onChange={(event) => { setOtherMas(false); setDraft((current) => ({ ...current, branch: event.target.value, masEmployeeId: "", masName: "", memberId: "" })); }}>{data.branches.map((name) => <option key={name}>{name}</option>)}</select>
                : <Input id="dm-branch" value={draft.branch} readOnly className="h-9" />}
            </div>
            <div className="space-y-1 md:col-span-4">
              <Label htmlFor="dm-mas">MAS</Label>
              {otherMas
                ? <div className="flex gap-1"><Input id="dm-mas" className="h-9" value={draft.masName} onChange={(event) => setDraft((current) => ({ ...current, masEmployeeId: "", masName: event.target.value, memberId: "" }))} placeholder="Type the MAS name" autoFocus={!record} />
                  <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-xs" onClick={() => { setOtherMas(false); setDraft((current) => ({ ...current, masEmployeeId: "", masName: "", memberId: "" })); }}>Back to list</Button></div>
                : <select id="dm-mas" className={field} value={draft.masEmployeeId} onChange={(event) => pickMas(event.target.value)}>
                  <option value="">Choose the MAS</option>
                  {masList.map((mas) => <option key={mas.id} value={mas.id}>{mas.name}</option>)}
                  <option value={OTHER_MAS}>Other MAS (type the name)…</option>
                </select>}
            </div>
            <div className="space-y-1 md:col-span-5">
              <div className="flex items-center justify-between gap-2"><Label htmlFor="dm-name">Name of the deceased member / beneficiary</Label>
                <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setTypingName((current) => !current); setDraft((current) => ({ ...current, memberId: "" })); }}>{typingName ? "Pick from the list" : "Type the name instead"}</button></div>
              {typingName
                ? <Input id="dm-name" className="h-9" value={draft.deceasedName} onChange={(event) => setDraft((current) => ({ ...current, memberId: "", deceasedName: event.target.value }))} placeholder="Surname, First name Middle name" />
                : <SearchSelect id="dm-name" className="h-9" options={members.map((item) => ({ value: item.id, label: item.name, description: [item.number, item.statuses.filter(Boolean).join(", ")].filter(Boolean).join(" · ") }))}
                  value={draft.memberId} onValueChange={pickMember} disabled={!draft.masName}
                  placeholder={!draft.masName ? "Choose the MAS first" : membersLoading ? "Loading members..." : "Search the member"}
                  emptyText={membersLoading ? "Loading members..." : "No member found. Use Type the name instead."} />}
            </div>
            <div className="space-y-1 md:col-span-4">
              <Label htmlFor="dm-program">Program</Label>
              <select id="dm-program" className={field} value={draft.programId} onChange={(event) => set("programId", event.target.value)}>
                <option value="">Choose the program</option>
                {programs.map((program) => <option key={program.id} value={program.id}>{program.name}{member?.programIds.includes(program.id) ? " (member's)" : program.active ? "" : " (inactive)"}</option>)}
              </select>
            </div>
            <div className="space-y-1 md:col-span-2"><Label htmlFor="dm-nop">NOP</Label><Input id="dm-nop" className="h-9" inputMode="numeric" value={draft.nop} onChange={(event) => set("nop", event.target.value.replace(/\D/g, ""))} placeholder="Number of payments" /></div>
            <div className="space-y-1 md:col-span-3"><Label htmlFor="dm-tmd">TMD (₱)</Label><Input id="dm-tmd" className="h-9" inputMode="decimal" value={draft.totalMonthlyDeposit} onChange={(event) => set("totalMonthlyDeposit", event.target.value.replace(/[^\d.,]/g, ""))} placeholder="Total monthly deposit" /></div>
            <div className="space-y-1 md:col-span-3"><Label htmlFor="dm-death">Date of death</Label><Input id="dm-death" className="h-9" type="date" max={data.today} value={draft.dateOfDeath} onChange={(event) => set("dateOfDeath", event.target.value)} /></div>
          </div>
        </FormSection>

        <FormSection title="Convert to services?">
          <div className="inline-flex rounded-lg border bg-background p-0.5" role="radiogroup" aria-label="Convert to services">
            {(["yes", "no"] as const).map((option) => <button key={option} type="button" role="radio" aria-checked={draft.convertedToServices === option}
              className={`min-w-20 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${draft.convertedToServices === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              onClick={() => set("convertedToServices", option)}>{option === "yes" ? "Yes" : "No"}</button>)}
          </div>
        </FormSection>

        <div className="grid gap-6 lg:grid-cols-2">
          <FormSection title="Requirements" hint="Tick what was handed in.">
            <Checklist name="req" items={data.requirements} ticked={draft.requirements} onToggle={(item) => toggle("requirements", item)} other={draft.requirementsOther} onOther={(value) => set("requirementsOther", value)} />
          </FormSection>
          <FormSection title="Claims" hint="Tick what was given.">
            <Checklist name="claim" items={data.claims} ticked={draft.claims} onToggle={(item) => toggle("claims", item)} other={draft.claimsOther} onOther={(value) => set("claimsOther", value)} label={(item) => /^\d/.test(item) ? `₱${item}` : item} />
          </FormSection>
        </div>

        {converted && <FormSection title="Services">
          <div className="grid gap-3 md:grid-cols-12 duration-200 animate-in fade-in-0 slide-in-from-top-1">
            <div className="space-y-2 md:col-span-7">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Service">
                {data.services.map((service) => <label key={service} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${draft.service === service ? "border-primary bg-primary/10 font-semibold" : "hover:bg-muted"}`}>
                  <input type="radio" name="dm-service" checked={draft.service === service} onChange={() => set("service", service)} />{service}
                </label>)}
              </div>
              {draft.service === OTHER && <Input className="h-9" value={draft.serviceOther} onChange={(event) => set("serviceOther", event.target.value)} placeholder="Type the service" aria-label="Other service" autoFocus />}
            </div>
            <div className="space-y-1 md:col-span-5"><Label htmlFor="dm-full">Amount of full payment (₱)</Label><Input id="dm-full" className="h-9" inputMode="decimal" value={draft.fullPaymentAmount} onChange={(event) => set("fullPaymentAmount", event.target.value.replace(/[^\d.,]/g, ""))} placeholder="0.00" /></div>
          </div>
        </FormSection>}

        <FormSection title="Release">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="space-y-1 md:col-span-3"><Label htmlFor="dm-release">Date of release</Label><Input id="dm-release" className="h-9" type="date" min={draft.dateOfDeath || undefined} value={draft.dateOfRelease} onChange={(event) => set("dateOfRelease", event.target.value)} /></div>
            <div className="space-y-1 md:col-span-9"><Label htmlFor="dm-remarks">Remarks / comments</Label><Textarea id="dm-remarks" rows={2} value={draft.remarks} onChange={(event) => set("remarks", event.target.value)} placeholder="Optional" /></div>
          </div>
        </FormSection>

        <FormSection title="Attached files" hint="Photos or scans of the requirements, PDFs, Word or Excel. As many as needed; large photos are made smaller for you.">
          <FileDrop onFiles={addFiles} disabled={Boolean(busy)} />
          {(files.length > 0 || queued.length > 0) && <ul className="mt-3 divide-y rounded-lg border">
            {files.map((file) => <li key={file.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileIcon type={file.type} /><a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">{file.name}</a>
              <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(file.size)}</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Remove ${file.name}`} onClick={() => void removeFile(file)} disabled={Boolean(busy)}><Trash2 className="size-4" /></Button>
            </li>)}
            {queued.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-3 px-3 py-2 text-sm">
              <FileIcon type={file.type} /><span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{sizeLabel(file.size)} · attached when saved</span>
              <Button type="button" size="icon-sm" variant="ghost" aria-label={`Do not attach ${file.name}`} onClick={() => setQueued((current) => current.filter((_, at) => at !== index))} disabled={Boolean(busy)}><X className="size-4" /></Button>
            </li>)}
          </ul>}
        </FormSection>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={Boolean(busy)}>{busy || (record ? "Save changes" : "Save record")}</Button>
          <Button type="button" variant="outline" onClick={onCancel} disabled={Boolean(busy)}>Cancel</Button>
        </div>
      </form>
    </CardContent>
  </Card>;
}

function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <fieldset className="space-y-2">
    <legend className="text-sm font-semibold text-foreground">{title}{hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}</legend>
    {children}
  </fieldset>;
}

function Checklist({ name, items, ticked, onToggle, other, onOther, label = (item) => item }: {
  name: string; items: string[]; ticked: string[]; onToggle: (item: string) => void; other: string; onOther: (value: string) => void; label?: (item: string) => string;
}) {
  return <div className="space-y-2">
    <div className="grid gap-1.5 sm:grid-cols-2">
      {[...items, OTHER].map((item) => <label key={item} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${ticked.includes(item) ? "border-primary/50 bg-primary/10" : "hover:bg-muted"}`}>
        <input type="checkbox" name={`${name}-${item}`} checked={ticked.includes(item)} onChange={() => onToggle(item)} />{item === OTHER ? "Other" : label(item)}
      </label>)}
    </div>
    {ticked.includes(OTHER) && <Input className="h-9" value={other} onChange={(event) => onOther(event.target.value)} placeholder="Type the other one" aria-label={`Other ${name === "req" ? "requirement" : "claim"}`} autoFocus />}
  </div>;
}

function FileDrop({ onFiles, disabled }: { onFiles: (files: FileList | null) => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return <div onDragOver={(event) => { event.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={(event) => { event.preventDefault(); setOver(false); if (!disabled) onFiles(event.dataTransfer.files); }}
    className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors ${over ? "border-primary bg-primary/5" : "border-input"}`}>
    <Upload className="size-5 text-muted-foreground" />
    <p className="text-muted-foreground">Drop files here, or</p>
    <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={disabled}><Paperclip className="mr-2 size-4" />Choose files</Button>
    <input ref={input} type="file" multiple accept={DECEASED_FILE_ACCEPT} className="hidden" onChange={(event) => { onFiles(event.target.files); event.target.value = ""; }} />
  </div>;
}

const FileIcon = ({ type }: { type: string }) => type.startsWith("image/") ? <ImageIcon className="size-4 shrink-0 text-muted-foreground" /> : <FileText className="size-4 shrink-0 text-muted-foreground" />;

// ---------------------------------------------------------------- one record

function RecordRow({ record, showBranch, showClerk, actions }: { record: DeceasedRecord; showBranch?: boolean; showClerk?: boolean; actions?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const missing = missingRequirements(record);
  const removed = record.status === "Removed";
  return <div className={`rounded-xl border transition-colors ${removed ? "opacity-70" : ""} ${open ? "bg-muted/30" : "hover:bg-muted/20"}`}>
    <button type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left">
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{record.deceasedName}</p>
        <p className="truncate text-xs text-muted-foreground">{[record.programName, showBranch ? record.branch : "", record.masName ? `MAS ${record.masName}` : "", showClerk ? `by ${record.employeeName}` : ""].filter(Boolean).join(" · ")}</p>
      </div>
      <span className="text-sm tabular-nums text-muted-foreground">Died {formatDate(record.dateOfDeath)}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {removed && <StatusBadge status="Removed" tone="neutral" />}
        <StatusBadge status={record.convertedToServices ? serviceLabel(record) || "Services" : "Claims"} tone={record.convertedToServices ? "brand" : "teal"} />
        <StatusBadge status={missing.length ? `${missing.length} requirement${missing.length === 1 ? "" : "s"} missing` : "Requirements complete"} tone={missing.length ? "warning" : "success"} />
        {record.files.length > 0 && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Paperclip className="size-3.5" />{record.files.length}</span>}
      </div>
      <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform duration-(--dur-base) ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div className="space-y-4 border-t px-4 py-4 text-sm duration-200 animate-in fade-in-0 slide-in-from-top-1">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
        <Detail label="Branch" value={record.branch} />
        <Detail label="MAS" value={record.masName} />
        <Detail label="Program" value={record.programName} />
        <Detail label="Date of death" value={formatDate(record.dateOfDeath)} />
        <Detail label="NOP" value={record.nop === null ? "" : String(record.nop)} />
        <Detail label="TMD" value={record.totalMonthlyDeposit === null ? "" : formatPeso(record.totalMonthlyDeposit)} />
        <Detail label="Converted to services" value={record.convertedToServices ? "Yes" : "No"} />
        {record.convertedToServices && <Detail label="Service" value={serviceLabel(record)} />}
        {record.convertedToServices && <Detail label="Amount of full payment" value={record.fullPaymentAmount === null ? "" : formatPeso(record.fullPaymentAmount)} />}
        <Detail label="Date of release" value={record.dateOfRelease ? formatDate(record.dateOfRelease) : ""} />
        <Detail label="Encoded" value={`${formatDate(record.addedAt)}${record.employeeName ? ` by ${record.employeeName}` : ""}`} />
        {removed && <Detail label="Removed because" value={record.removedReason} />}
      </dl>
      <div className="grid gap-4 md:grid-cols-2">
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requirements</p>
          <TickList items={listWithOther(record.requirements, record.requirementsOther)} missing={missing} /></div>
        <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claims</p>
          <TickList items={listWithOther(record.claims, record.claimsOther).map((item) => /^\d/.test(item) ? `₱${item}` : item)} /></div>
      </div>
      {record.remarks && <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remarks</p><p className="whitespace-pre-line">{record.remarks}</p></div>}
      <div><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files ({record.files.length})</p>
        {!record.files.length ? <p className="text-muted-foreground">No file attached.</p>
          : <ul className="flex flex-wrap gap-2">{record.files.map((file) => <li key={file.id} className="flex items-center gap-1 rounded-lg border bg-background pl-2.5">
            <FileIcon type={file.type} /><a href={fileUrl(file.id)} target="_blank" rel="noreferrer" className="max-w-56 truncate py-1.5 text-sm hover:underline" title={file.name}>{file.name}</a>
            <a href={fileUrl(file.id, true)} className="rounded-r-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Download ${file.name}`}><Download className="size-3.5" /></a>
          </li>)}</ul>}
      </div>
      {actions && <div className="flex flex-wrap gap-2 border-t pt-3">{actions}</div>}
    </div>}
  </div>;
}

const Detail = ({ label, value }: { label: string; value: string }) => <div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-medium">{value || "—"}</dd></div>;

function TickList({ items, missing = [] }: { items: string[]; missing?: readonly string[] }) {
  if (!items.length && !missing.length) return <p className="text-muted-foreground">None ticked.</p>;
  return <ul className="space-y-0.5">
    {items.map((item) => <li key={item} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-brand-moss" aria-hidden />{item}</li>)}
    {missing.map((item) => <li key={item} className="flex items-center gap-2 text-muted-foreground"><span className="size-1.5 rounded-full bg-brand-gold" aria-hidden />{item} <span className="text-xs">(missing)</span></li>)}
  </ul>;
}

// ---------------------------------------------------------------- every record (Administrators and Finance)

function Overview({ data, showRemoved, setShowRemoved }: { data: Data; showRemoved: boolean; setShowRemoved: (value: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [clerk, setClerk] = useState("");
  const [kind, setKind] = useState<"" | "services" | "claims">("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = search.trim().toLowerCase();
  const branches = [...new Set(data.records.map((record) => record.branch))].sort();
  const clerks = [...new Map(data.records.map((record) => [record.employeeId, record.employeeName || record.employeeId])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const shown = data.records.filter((record) => (!query || `${record.deceasedName} ${record.programName} ${record.masName} ${record.remarks} ${record.employeeName}`.toLowerCase().includes(query))
    && (!branch || record.branch === branch) && (!clerk || record.employeeId === clerk)
    && (!kind || (kind === "services") === record.convertedToServices) && (!missingOnly || missingRequirements(record).length > 0)
    && (!from || record.dateOfDeath >= from) && (!to || record.dateOfDeath <= to));
  const filtered = Boolean(query || branch || clerk || kind || missingOnly || from || to);
  const active = shown.filter((record) => record.status === "Active");
  const fullPayments = active.reduce((total, record) => total + (record.fullPaymentAmount ?? 0), 0);

  function downloadCsv() {
    const header = ["Record ID", "Branch", "MAS", "Deceased member / beneficiary", "Program", "Converted to services", "NOP", "TMD", "Date of death", "Requirements", "Missing requirements", "Claims", "Service", "Amount of full payment", "Date of release", "Remarks", "Files", "Encoded by", "Encoded on", "Status", "Removed reason"];
    const lines = [header, ...shown.map((record) => [record.id, record.branch, record.masName, record.deceasedName, record.programName, record.convertedToServices ? "Yes" : "No", record.nop ?? "", record.totalMonthlyDeposit ?? "", record.dateOfDeath,
      listWithOther(record.requirements, record.requirementsOther).join("; "), missingRequirements(record).join("; "), listWithOther(record.claims, record.claimsOther).join("; "), serviceLabel(record), record.fullPaymentAmount ?? "", record.dateOfRelease,
      record.remarks, record.files.length, record.employeeName, record.addedAt.slice(0, 10), record.status, record.removedReason])];
    const blob = new Blob([`﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `deceased-members-${data.today}.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  return <div className="space-y-6">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Deceased members" value={active.length} detail={filtered ? "matching the filters" : "encoded"} icon={Flower2} tone="brand" />
      <MetricTile label="Converted to services" value={active.filter((record) => record.convertedToServices).length} detail={`${formatPeso(fullPayments)} full payments`} icon={Users} tone="info" />
      <MetricTile label="Requirements missing" value={active.filter((record) => missingRequirements(record).length > 0).length} detail="records still lacking one" icon={FileText} tone="warning" onClick={() => setMissingOnly(true)} />
      <MetricTile label="Files attached" value={active.reduce((total, record) => total + record.files.length, 0)} detail="documents on the records" icon={Paperclip} tone="teal" />
    </div>
    <Card>
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Every record <span className="font-normal text-muted-foreground">({shown.length})</span></CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => { setSearch(""); setBranch(""); setClerk(""); setKind(""); setMissingOnly(false); setFrom(""); setTo(""); }}>Clear filters</Button>}
            <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />Show removed</label>
            <Button type="button" size="sm" variant="outline" onClick={downloadCsv} disabled={!shown.length}><Download className="mr-2 size-4" />CSV</Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-56 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="h-9 pl-8" placeholder="Search name, program, MAS, clerk, remarks" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search records" /></div>
          <select className={`${field} w-auto`} value={branch} onChange={(event) => setBranch(event.target.value)} aria-label="Branch"><option value="">All branches</option>{branches.map((name) => <option key={name}>{name}</option>)}</select>
          <select className={`${field} w-auto`} value={clerk} onChange={(event) => setClerk(event.target.value)} aria-label="Clerk"><option value="">All clerks</option>{clerks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          <select className={`${field} w-auto`} value={kind} onChange={(event) => setKind(event.target.value as typeof kind)} aria-label="Claims or services"><option value="">Claims and services</option><option value="claims">Claims (not converted)</option><option value="services">Converted to services</option></select>
          <select className={`${field} w-auto`} value={missingOnly ? "missing" : ""} onChange={(event) => setMissingOnly(event.target.value === "missing")} aria-label="Requirements"><option value="">Any requirements</option><option value="missing">Requirements missing</option></select>
          <div className="flex items-center gap-1 text-sm text-muted-foreground"><span>Died</span><Input type="date" className="h-9 w-auto" value={from} onChange={(event) => setFrom(event.target.value)} aria-label="Died from" /><span>to</span><Input type="date" className="h-9 w-auto" value={to} onChange={(event) => setTo(event.target.value)} aria-label="Died to" /></div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2 pt-4">
        {!data.records.length ? <p className="py-6 text-center text-sm text-muted-foreground">No deceased member has been encoded yet.</p>
          : !shown.length ? <p className="py-6 text-center text-sm text-muted-foreground">No record matches the filters.</p>
            : shown.map((record) => <RecordRow key={record.id} record={record} showBranch showClerk />)}
      </CardContent>
    </Card>
  </div>;
}

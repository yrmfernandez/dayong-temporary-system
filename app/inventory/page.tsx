"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type FormEvent, type RefObject, type SetStateAction } from "react";
import { AlertTriangle, Boxes, CalendarCheck, Download, Minus, Pencil, Plus, RefreshCw, RotateCcw, Search, Trash2, Users, Wallet, X } from "lucide-react";

import { confirmDialog, promptDialog } from "@/components/app-dialog";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge, type Tone } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseJsonResponse } from "@/lib/api-response";
import { formatDate } from "@/lib/date-format";
import { checkOverdue, CHECK_EVERY_DAYS, daysBetween, isLowStock, needsAttention, type InventoryCondition, type InventoryItem } from "@/lib/inventory-rules";
import { formatPeso } from "@/lib/money";
import { useLiveRefresh } from "@/lib/use-live-refresh";

type Data = {
  success: boolean; message?: string; view: "mine" | "all"; canOversee: boolean; today: string; items: InventoryItem[];
  branches: string[]; primaryBranch: string; conditions: InventoryCondition[]; categories: string[]; units: string[];
};
type Draft = { name: string; quantity: string; unit: string; category: string; condition: string; minQuantity: string; unitCost: string; note: string; branch: string };
type Show = "all" | "attention" | "low" | "unchecked";

const field = "h-9 w-full rounded-md border bg-background px-3 text-sm";
const conditionTone: Record<string, Tone> = { Good: "success", "Needs repair": "warning", Damaged: "danger", Missing: "danger" };
const emptyDraft = (branch: string, keep?: Partial<Draft>): Draft => ({ name: "", quantity: "1", unit: keep?.unit ?? "pcs", category: keep?.category ?? "", condition: "Good", minQuantity: "", unitCost: "", note: "", branch });
const csvCell = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
const itemValue = (item: InventoryItem) => (item.unitCost ?? 0) * item.quantity;
const checkedLabel = (item: InventoryItem, today: string) => {
  if (!item.lastCheckedOn) return "Never checked";
  const days = daysBetween(item.lastCheckedOn, today);
  return days <= 0 ? "Checked today" : days === 1 ? "Checked yesterday" : `Checked ${formatDate(item.lastCheckedOn)}`;
};

async function send(method: "POST" | "PATCH", body: Record<string, unknown>) {
  const response = await fetch("/api/inventory", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await parseJsonResponse<{ success: boolean; message?: string; item?: InventoryItem }>(response);
  return { ok: response.ok && result.success, message: result.message ?? (response.ok ? "Saved." : "Unable to save."), item: result.item };
}

/**
 * Inventory (owner, November 26, 2026; lib/inventory.ts). An Entry Clerk lists what they keep for their branch and
 * keeps it current with + and −; Administrators and Finance see every clerk's list, view only, with filters and CSV.
 */
export default function InventoryPage() {
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<"mine" | "all">("all");
  const [showRemoved, setShowRemoved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const savingRef = useRef(0);

  const load = useCallback(async () => {
    if (savingRef.current > 0) return; // a quantity change is on its way; its own reload follows
    setLoading(true);
    try {
      const response = await fetch(`/api/inventory?view=${view}${showRemoved ? "&removed=1" : ""}`, { cache: "no-store" });
      const result = await parseJsonResponse<Data>(response);
      if (!response.ok || !result.success) { setNotice({ ok: false, text: result.message || "Unable to load the inventory." }); return; }
      setData(result);
    } finally { setLoading(false); }
  }, [view, showRemoved]);
  useEffect(() => {
    void load();
  }, [load]);
  useLiveRefresh(["inventory_items"], load);

  const say = (ok: boolean, text: string) => setNotice({ ok, text });
  const mode = data?.view ?? view;
  const hasOwnList = Boolean(data && (data.branches.length > 0 || !data.canOversee));

  return <section className="mx-auto max-w-7xl space-y-6">
    <header className="flex flex-col gap-3 rounded-3xl page-hero p-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3">
        <div className="rounded-xl bg-violet-95 p-3 text-violet-40"><Boxes className="size-6" /></div>
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-violet-30/80">{mode === "all"
            ? "Every Entry Clerk's inventory, by branch and clerk. View only: each clerk keeps their own list. Use the filters to find low stock, damaged items or lists not checked lately."
            : "List what you keep for your branch: supplies, forms, equipment. Use + and − when you use or receive some, and Mark all as checked after you count everything."}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {data?.canOversee && hasOwnList && <div className="inline-flex rounded-lg border bg-background p-0.5" role="tablist" aria-label="Whose inventory">
          {(["all", "mine"] as const).map((option) => <button key={option} type="button" role="tab" aria-selected={view === option}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === option ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            onClick={() => setView(option)}>{option === "all" ? "Every clerk" : "My inventory"}</button>)}
        </div>}
        <Button type="button" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Refresh</Button>
      </div>
    </header>

    {notice && <div className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-sm ${notice.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"}`} role="status">
      <span>{notice.text}</span>
      <button type="button" aria-label="Close" onClick={() => setNotice(null)}><X className="size-4" /></button>
    </div>}

    {!data ? <p className="p-6 text-sm text-muted-foreground">Loading inventory...</p>
      : mode === "all"
        ? <Overview data={data} showRemoved={showRemoved} setShowRemoved={setShowRemoved} />
        : <MyInventory data={data} showRemoved={showRemoved} setShowRemoved={setShowRemoved} say={say} reload={load} savingRef={savingRef} setData={setData} />}
  </section>;
}

// ---------------------------------------------------------------- the clerk's own list

function MyInventory({ data, showRemoved, setShowRemoved, say, reload, savingRef, setData }: {
  data: Data; showRemoved: boolean; setShowRemoved: (value: boolean) => void; say: (ok: boolean, text: string) => void;
  reload: () => Promise<void>; savingRef: RefObject<number>; setData: Dispatch<SetStateAction<Data | null>>;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [branch, setBranch] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [editing, setEditing] = useState("");
  const timers = useRef(new Map<string, number>());

  const active = data.items.filter((item) => item.status === "Active");
  const categories = [...new Set([...data.categories, ...data.items.map((item) => item.category).filter(Boolean)])].sort();
  const usedCategories = [...new Set(data.items.map((item) => item.category).filter(Boolean))].sort();
  const attention = active.filter(needsAttention);
  const unchecked = active.filter((item) => checkOverdue(item.lastCheckedOn, data.today));
  const value = active.reduce((sum, item) => sum + itemValue(item), 0);
  const oldestCheck = active.length ? active.map((item) => item.lastCheckedOn).sort()[0] : "";

  const query = search.trim().toLowerCase();
  const shown = data.items.filter((item) => (!query || `${item.name} ${item.category} ${item.note}`.toLowerCase().includes(query))
    && (!category || item.category === category) && (!branch || item.branch === branch)
    && (show === "all" || (item.status === "Active" && (show === "attention" ? needsAttention(item) : show === "low" ? isLowStock(item) : checkOverdue(item.lastCheckedOn, data.today)))));

  const patchLocal = (id: string, change: Partial<InventoryItem>) => setData((current) => current && { ...current, items: current.items.map((item) => item.id === id ? { ...item, ...change } : item) });

  /** + and −: the number changes at once and is saved after a short pause, so several taps make one save. */
  const changeQuantity = (item: InventoryItem, next: number) => {
    const quantity = Math.max(0, Math.min(1_000_000, Math.round(next)));
    patchLocal(item.id, { quantity });
    const pending = timers.current.get(item.id);
    if (pending) window.clearTimeout(pending); else savingRef.current += 1;
    timers.current.set(item.id, window.setTimeout(async () => {
      timers.current.delete(item.id);
      const result = await send("PATCH", { action: "update", id: item.id, quantity });
      savingRef.current = Math.max(0, savingRef.current - 1);
      if (!result.ok) { say(false, result.message); await reload(); }
    }, 700));
  };

  const saveField = async (item: InventoryItem, change: Record<string, unknown>) => {
    const result = await send("PATCH", { action: "update", id: item.id, ...change });
    if (result.ok && result.item) patchLocal(item.id, result.item); else say(false, result.message);
  };

  const remove = async (item: InventoryItem) => {
    const reason = await promptDialog(`Remove ${item.name} from your ${item.branch} list? Say why (used up, disposed, transferred to another branch...). It stays on record and can be restored.`, { title: "Remove item", confirmLabel: "Remove", required: true, placeholder: "Reason" });
    if (!reason?.trim()) return;
    const result = await send("PATCH", { action: "remove", id: item.id, reason });
    say(result.ok, result.message);
    if (result.ok) await reload();
  };
  const restore = async (item: InventoryItem) => {
    const result = await send("PATCH", { action: "restore", id: item.id });
    say(result.ok, result.message);
    if (result.ok) await reload();
  };
  const markChecked = async () => {
    const targetBranch = branch || (data.branches.length === 1 ? data.branches[0] : "");
    const count = active.filter((item) => !targetBranch || item.branch === targetBranch).length;
    if (!count) return;
    const ok = await confirmDialog(`Did you count all ${count} item${count === 1 ? "" : "s"}${targetBranch ? ` of ${targetBranch}` : ""} and are the quantities right? Each gets today as its check date.`, { title: "Mark all as checked", confirmLabel: "Yes, all checked" });
    if (!ok) return;
    const result = await send("PATCH", { action: "check", branch: targetBranch });
    say(result.ok, result.message);
    if (result.ok) await reload();
  };

  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile label="Items on your list" value={active.length} detail={`${active.reduce((sum, item) => sum + item.quantity, 0).toLocaleString()} pieces in all`} icon={Boxes} />
      <MetricTile label="Need attention" value={attention.length} detail="Low stock, for repair, damaged or missing" icon={AlertTriangle} tone={attention.length ? "warning" : "success"} onClick={() => setShow(show === "attention" ? "all" : "attention")} />
      <MetricTile label="Last full check" value={!active.length ? "—" : oldestCheck ? formatDate(oldestCheck) : "Not yet"} detail={unchecked.length ? `${unchecked.length} not checked in ${CHECK_EVERY_DAYS} days` : "Everything checked recently"} icon={CalendarCheck} tone={unchecked.length ? "orange" : "success"} onClick={() => setShow(show === "unchecked" ? "all" : "unchecked")} />
      <MetricTile label="Value" value={formatPeso(value)} detail="From the unit costs you typed" icon={Wallet} tone="teal" />
    </div>

    <AddItemForm data={data} categories={categories} say={say} reload={reload} />

    <Card>
      <CardHeader className="gap-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Your list ({shown.length}{shown.length !== data.items.length ? ` of ${data.items.length}` : ""})</CardTitle>
          <Button type="button" size="sm" onClick={() => void markChecked()} disabled={!active.length}><CalendarCheck className="mr-2 size-4" />Mark all as checked today</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search items" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          {usedCategories.length > 1 && <select className={`${field} w-auto`} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category"><option value="">All categories</option>{usedCategories.map((name) => <option key={name}>{name}</option>)}</select>}
          {data.branches.length > 1 && <select className={`${field} w-auto`} value={branch} onChange={(event) => setBranch(event.target.value)} aria-label="Branch"><option value="">All my branches</option>{data.branches.map((name) => <option key={name}>{name}</option>)}</select>}
          <ShowChips show={show} setShow={setShow} />
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />Show removed</label>
        </div>
      </CardHeader>
      <CardContent>
        {!data.items.length ? <EmptyState text="Your list is empty. Add your first item above: what it is, how many, and its condition." />
          : !shown.length ? <EmptyState text="No item matches these filters." />
            : <ul className="divide-y rounded-lg border">
              {shown.map((item) => <li key={item.id} className={item.status === "Removed" ? "bg-muted/40" : ""}>
                {editing === item.id
                  ? <EditItem item={item} data={data} categories={categories} onDone={(saved) => { setEditing(""); if (saved) { patchLocal(item.id, saved); say(true, `${saved.name} saved.`); } }} say={say} />
                  : <ItemRow item={item} data={data} showBranch={data.branches.length > 1} onQuantity={(next) => changeQuantity(item, next)} onCondition={(condition) => void saveField(item, { condition })}
                    onEdit={() => setEditing(item.id)} onRemove={() => void remove(item)} onRestore={() => void restore(item)} />}
              </li>)}
            </ul>}
      </CardContent>
    </Card>
  </>;
}

function AddItemForm({ data, categories, say, reload }: { data: Data; categories: string[]; say: (ok: boolean, text: string) => void; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(data.primaryBranch || data.branches[0] || ""));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const names = useMemo(() => [...new Set(data.items.map((item) => item.name))].sort(), [data.items]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await send("POST", { ...draft });
      say(result.ok, result.message);
      if (result.ok) {
        // Keep the branch, category and unit: items are usually listed several of a kind at a time.
        setDraft((current) => emptyDraft(current.branch, current));
        await reload();
        nameRef.current?.focus();
      }
    } finally { setBusy(false); }
  };

  if (!data.branches.length) return <Card><CardContent className="py-6 text-sm text-muted-foreground">You have no branch yet, so you cannot list items. Ask an administrator to set your branch in Employees.</CardContent></Card>;
  const quantity = Number(draft.quantity) || 0;

  return <Card>
    <CardHeader className="pb-2"><CardTitle className="text-base">Add an item</CardTitle></CardHeader>
    <CardContent>
      <form onSubmit={(event) => void submit(event)} className="space-y-3">
        <div className="grid gap-3 md:grid-cols-12">
          <div className="space-y-1 md:col-span-4">
            <Label htmlFor="inv-name">Item</Label>
            <Input id="inv-name" ref={nameRef} list="inv-names" placeholder="e.g. Official receipt booklet" value={draft.name} onChange={set("name")} autoComplete="off" required minLength={2} />
            <datalist id="inv-names">{names.map((name) => <option key={name} value={name} />)}</datalist>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-qty">Quantity</Label>
            <Stepper className="flex w-full" lessLabel="Less" moreLabel="More" onLess={() => setDraft((current) => ({ ...current, quantity: String(Math.max(0, quantity - 1)) }))} onMore={() => setDraft((current) => ({ ...current, quantity: String(quantity + 1) }))}>
              <input id="inv-qty" inputMode="numeric" className={stepperInput} value={draft.quantity} onChange={(event) => setDraft((current) => ({ ...current, quantity: event.target.value.replace(/\D/g, "") }))} />
            </Stepper>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-unit">Unit</Label>
            <Input id="inv-unit" list="inv-units" value={draft.unit} onChange={set("unit")} placeholder="pcs" />
            <datalist id="inv-units">{data.units.map((unit) => <option key={unit} value={unit} />)}</datalist>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-category">Category</Label>
            <CategoryField id="inv-category" value={draft.category} categories={categories} onChange={(category) => setDraft((current) => ({ ...current, category }))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-condition">Condition</Label>
            <select id="inv-condition" className={field} value={draft.condition} onChange={set("condition")}>{data.conditions.map((name) => <option key={name}>{name}</option>)}</select>
          </div>
        </div>
        {more && <div className="grid gap-3 md:grid-cols-12">
          {data.branches.length > 1 && <div className="space-y-1 md:col-span-3">
            <Label htmlFor="inv-branch">Branch</Label>
            <select id="inv-branch" className={field} value={draft.branch} onChange={set("branch")}>{data.branches.map((name) => <option key={name}>{name}</option>)}</select>
          </div>}
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-min">Alert when at or below</Label>
            <Input id="inv-min" inputMode="numeric" placeholder="optional" value={draft.minQuantity} onChange={(event) => setDraft((current) => ({ ...current, minQuantity: event.target.value.replace(/\D/g, "") }))} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="inv-cost">Unit cost (₱)</Label>
            <Input id="inv-cost" inputMode="decimal" placeholder="optional" value={draft.unitCost} onChange={(event) => setDraft((current) => ({ ...current, unitCost: event.target.value.replace(/[^\d.]/g, "") }))} />
          </div>
          <div className={`space-y-1 ${data.branches.length > 1 ? "md:col-span-5" : "md:col-span-8"}`}>
            <Label htmlFor="inv-note">Note</Label>
            <Input id="inv-note" placeholder="Serial number, where it is kept... (optional)" value={draft.note} onChange={set("note")} />
          </div>
        </div>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setMore(!more)}>
            {more ? "Fewer details" : `More details (${data.branches.length > 1 ? "branch, " : ""}low stock alert, cost, note)`}
          </button>
          <div className="flex items-center gap-3">
            {data.branches.length > 1 && !more && <span className="text-xs text-muted-foreground">For {draft.branch}</span>}
            <Button type="submit" disabled={busy || draft.name.trim().length < 2}><Plus className="mr-2 size-4" />{busy ? "Adding..." : "Add item"}</Button>
          </div>
        </div>
      </form>
    </CardContent>
  </Card>;
}

function ItemRow({ item, data, showBranch, onQuantity, onCondition, onEdit, onRemove, onRestore }: {
  item: InventoryItem; data: Data; showBranch: boolean; onQuantity: (next: number) => void; onCondition: (condition: string) => void; onEdit: () => void; onRemove: () => void; onRestore: () => void;
}) {
  const removed = item.status === "Removed";
  const low = isLowStock(item);
  const overdue = checkOverdue(item.lastCheckedOn, data.today);
  return <div className="flex flex-col gap-3 p-3 md:flex-row md:items-center">
    <div className="min-w-0 flex-1 space-y-1">
      <p className="flex flex-wrap items-center gap-2 font-semibold">
        <span className={removed ? "text-muted-foreground line-through" : ""}>{item.name}</span>
        {low && !removed && <StatusBadge status="Low stock" tone="warning" />}
        {removed && <StatusBadge status="Removed" tone="neutral" />}
      </p>
      <p className="text-xs text-muted-foreground">
        {[item.category, showBranch ? item.branch : "", item.unitCost !== null ? `${formatPeso(item.unitCost)} each` : "", item.minQuantity !== null ? `alert at ${item.minQuantity}` : ""].filter(Boolean).join(" · ")}
        {item.note && <span className="block">{item.note}</span>}
        {removed
          ? <span className="block">Removed: {item.removedReason}</span>
          : <span className={`block ${overdue ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{checkedLabel(item, data.today)}</span>}
      </p>
    </div>
    {removed
      ? <Button type="button" size="sm" variant="outline" onClick={onRestore}><RotateCcw className="mr-2 size-4" />Restore</Button>
      : <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center" aria-label={`Quantity of ${item.name}`}>
          <Stepper className="inline-flex w-[6.75rem]" lessLabel={`One less ${item.name}`} moreLabel={`One more ${item.name}`} lessDisabled={item.quantity <= 0} onLess={() => onQuantity(item.quantity - 1)} onMore={() => onQuantity(item.quantity + 1)}>
            <QuantityInput value={item.quantity} onChange={onQuantity} label={item.name} />
          </Stepper>
          <span className="ml-2 w-14 text-sm text-muted-foreground">{item.unit || "pcs"}</span>
        </div>
        <select className={`${field} w-36`} value={item.condition} onChange={(event) => onCondition(event.target.value)} aria-label={`Condition of ${item.name}`}>
          {data.conditions.map((name) => <option key={name}>{name}</option>)}
        </select>
        <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.name}`} title="Edit" onClick={onEdit}><Pencil className="size-4" /></Button>
        <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${item.name}`} title="Remove" onClick={onRemove}><Trash2 className="size-4" /></Button>
      </div>}
  </div>;
}

/*
 * Quantity: one rounded box the height of the other fields, with small − and + inside (owner, November 26, 2026: the
 * separate 40 px buttons were too big). Taller on phones so a thumb still hits them.
 */
const stepperInput = "h-full min-w-0 flex-1 border-0 bg-transparent! p-0 text-center text-sm tabular-nums shadow-none! outline-none min-h-0!";
const stepButton = "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-[background-color,color,scale] duration-(--dur-fast) hover:bg-muted hover:text-foreground active:scale-90 disabled:pointer-events-none disabled:opacity-40 max-md:size-9";

function Stepper({ className, lessLabel, moreLabel, lessDisabled, onLess, onMore, children }: { className: string; lessLabel: string; moreLabel: string; lessDisabled?: boolean; onLess: () => void; onMore: () => void; children: React.ReactNode }) {
  return <div className={`${className} h-9 items-center gap-0.5 rounded-md border border-input bg-background px-1 focus-within:border-primary focus-within:ring-3 focus-within:ring-primary/20 max-md:h-11`}>
    <button type="button" className={stepButton} aria-label={lessLabel} disabled={lessDisabled} onClick={onLess}><Minus className="size-3.5" /></button>
    {children}
    <button type="button" className={stepButton} aria-label={moreLabel} onClick={onMore}><Plus className="size-3.5" /></button>
  </div>;
}

const NEW_CATEGORY = "__new_category__";

/**
 * Category: the same dropdown as Condition (owner, November 26, 2026), listing the categories already in use;
 * "New category…" turns it into a box to type one, and "Back to list" returns.
 */
function CategoryField({ id, value, categories, onChange }: { id: string; value: string; categories: string[]; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false);
  const listed = !value || categories.includes(value);
  if (typing || !listed) return <div className="flex gap-1">
    <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} placeholder="New category" autoFocus={typing} className="h-9" />
    <Button type="button" variant="ghost" size="sm" className="shrink-0 px-2 text-xs" onClick={() => { setTyping(false); if (!categories.includes(value)) onChange(""); }}>Back to list</Button>
  </div>;
  return <select id={id} className={field} value={value} onChange={(event) => { if (event.target.value === NEW_CATEGORY) { setTyping(true); onChange(""); } else onChange(event.target.value); }}>
    <option value="">No category</option>
    {categories.map((name) => <option key={name} value={name}>{name}</option>)}
    <option value={NEW_CATEGORY}>New category…</option>
  </select>;
}

/** The quantity, typed directly; saved when the field is left or Enter is pressed. */
function QuantityInput({ value, onChange, label }: { value: number; onChange: (next: number) => void; label: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => { if (typed !== null && typed !== "" && Number(typed) !== value) onChange(Number(typed)); setTyped(null); };
  return <input inputMode="numeric" aria-label={`Quantity of ${label}`} className={`${stepperInput} font-semibold`}
    value={typed ?? String(value)} onFocus={(event) => event.target.select()} onChange={(event) => setTyped(event.target.value.replace(/\D/g, ""))}
    onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur(); } if (event.key === "Escape") setTyped(null); }} />;
}

function EditItem({ item, data, categories, onDone, say }: { item: InventoryItem; data: Data; categories: string[]; onDone: (saved: InventoryItem | null) => void; say: (ok: boolean, text: string) => void }) {
  const [draft, setDraft] = useState({ name: item.name, category: item.category, unit: item.unit, minQuantity: item.minQuantity === null ? "" : String(item.minQuantity), unitCost: item.unitCost === null ? "" : String(item.unitCost), note: item.note });
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await send("PATCH", { action: "update", id: item.id, ...draft });
      if (result.ok && result.item) onDone(result.item); else say(false, result.message);
    } finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void save(event)} className="space-y-3 bg-muted/30 p-3">
    <div className="grid gap-3 md:grid-cols-12">
      <div className="space-y-1 md:col-span-4"><Label htmlFor={`e-name-${item.id}`}>Item</Label><Input id={`e-name-${item.id}`} value={draft.name} onChange={set("name")} required minLength={2} autoFocus /></div>
      <div className="space-y-1 md:col-span-3"><Label htmlFor={`e-cat-${item.id}`}>Category</Label><CategoryField id={`e-cat-${item.id}`} value={draft.category} categories={categories} onChange={(category) => setDraft((current) => ({ ...current, category }))} /></div>
      <div className="space-y-1 md:col-span-1"><Label htmlFor={`e-unit-${item.id}`}>Unit</Label><Input id={`e-unit-${item.id}`} list="inv-units-edit" value={draft.unit} onChange={set("unit")} /><datalist id="inv-units-edit">{data.units.map((unit) => <option key={unit} value={unit} />)}</datalist></div>
      <div className="space-y-1 md:col-span-2"><Label htmlFor={`e-min-${item.id}`}>Alert at or below</Label><Input id={`e-min-${item.id}`} inputMode="numeric" value={draft.minQuantity} onChange={(event) => setDraft((current) => ({ ...current, minQuantity: event.target.value.replace(/\D/g, "") }))} placeholder="none" /></div>
      <div className="space-y-1 md:col-span-2"><Label htmlFor={`e-cost-${item.id}`}>Unit cost (₱)</Label><Input id={`e-cost-${item.id}`} inputMode="decimal" value={draft.unitCost} onChange={(event) => setDraft((current) => ({ ...current, unitCost: event.target.value.replace(/[^\d.]/g, "") }))} placeholder="none" /></div>
      <div className="space-y-1 md:col-span-12"><Label htmlFor={`e-note-${item.id}`}>Note</Label><Input id={`e-note-${item.id}`} value={draft.note} onChange={set("note")} /></div>
    </div>
    <div className="flex justify-end gap-2">
      <Button type="button" variant="ghost" onClick={() => onDone(null)}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
    </div>
  </form>;
}

// ---------------------------------------------------------------- Administrators and Finance: every clerk's list

function Overview({ data, showRemoved, setShowRemoved }: { data: Data; showRemoved: boolean; setShowRemoved: (value: boolean) => void }) {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("");
  const [clerk, setClerk] = useState("");
  const [category, setCategory] = useState("");
  const [show, setShow] = useState<Show>("all");

  const branches = [...new Set(data.items.map((item) => item.branch))].sort();
  const clerks = [...new Map(data.items.filter((item) => !branch || item.branch === branch).map((item) => [item.employeeId, item.employeeName || item.employeeId])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const categories = [...new Set(data.items.map((item) => item.category).filter(Boolean))].sort();
  const query = search.trim().toLowerCase();
  const shown = data.items.filter((item) => (!query || `${item.name} ${item.category} ${item.note} ${item.employeeName}`.toLowerCase().includes(query))
    && (!branch || item.branch === branch) && (!clerk || item.employeeId === clerk) && (!category || item.category === category)
    && (show === "all" || (item.status === "Active" && (show === "attention" ? needsAttention(item) : show === "low" ? isLowStock(item) : checkOverdue(item.lastCheckedOn, data.today)))));
  const filtered = Boolean(query || branch || clerk || category || show !== "all");

  // One group per branch and clerk, branches A to Z.
  const groups = [...shown.reduce((map, item) => {
    const key = `${item.branch}\u0000${item.employeeId}`;
    map.set(key, [...(map.get(key) ?? []), item]);
    return map;
  }, new Map<string, InventoryItem[]>()).values()].sort((a, b) => a[0].branch.localeCompare(b[0].branch) || a[0].employeeName.localeCompare(b[0].employeeName));

  const shownActive = shown.filter((item) => item.status === "Active");
  const exportCsv = () => {
    const header = ["Branch", "Clerk", "Item", "Category", "Quantity", "Unit", "Condition", "Low stock at", "Unit cost", "Value", "Last checked", "Status", "Removed reason", "Note", "Item ID"];
    const lines = [header, ...shown.map((item) => [item.branch, item.employeeName, item.name, item.category, item.quantity, item.unit, item.condition, item.minQuantity ?? "", item.unitCost ?? "", item.unitCost === null ? "" : itemValue(item).toFixed(2), item.lastCheckedOn, item.status, item.removedReason, item.note, item.id])];
    const blob = new Blob([`﻿${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = `inventory-${branch ? `${branch.replace(/\W+/g, "-").toLowerCase()}-` : ""}${data.today}.csv`; link.click();
    URL.revokeObjectURL(link.href);
  };

  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MetricTile label="Items listed" value={shownActive.length} detail={`${new Set(shownActive.map((item) => item.employeeId)).size} clerks · ${new Set(shownActive.map((item) => item.branch)).size} branches`} icon={Users} />
      <MetricTile label="Need attention" value={shownActive.filter(needsAttention).length} detail="Low stock, for repair, damaged or missing" icon={AlertTriangle} tone={shownActive.some(needsAttention) ? "warning" : "success"} onClick={() => setShow(show === "attention" ? "all" : "attention")} />
      <MetricTile label={`Not checked in ${CHECK_EVERY_DAYS} days`} value={shownActive.filter((item) => checkOverdue(item.lastCheckedOn, data.today)).length} detail="Never checked, or checked long ago" icon={CalendarCheck} tone={shownActive.some((item) => checkOverdue(item.lastCheckedOn, data.today)) ? "orange" : "success"} onClick={() => setShow(show === "unchecked" ? "all" : "unchecked")} />
      <MetricTile label="Value" value={formatPeso(shownActive.reduce((sum, item) => sum + itemValue(item), 0))} detail="Items with a unit cost" icon={Wallet} tone="teal" />
    </div>

    <Card>
      <CardHeader className="gap-3 pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Every clerk&apos;s inventory ({shown.length}{filtered ? ` of ${data.items.length}` : ""})</CardTitle>
          <div className="flex gap-2">
            {filtered && <Button type="button" size="sm" variant="ghost" onClick={() => { setSearch(""); setBranch(""); setClerk(""); setCategory(""); setShow("all"); }}>Clear filters</Button>}
            <Button type="button" size="sm" variant="outline" onClick={exportCsv} disabled={!shown.length}><Download className="mr-2 size-4" />Download CSV</Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-8" placeholder="Search item, note or clerk" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
          <select className={`${field} w-auto`} value={branch} onChange={(event) => { setBranch(event.target.value); setClerk(""); }} aria-label="Branch"><option value="">All branches</option>{branches.map((name) => <option key={name}>{name}</option>)}</select>
          <select className={`${field} w-auto`} value={clerk} onChange={(event) => setClerk(event.target.value)} aria-label="Clerk"><option value="">All clerks</option>{clerks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          {categories.length > 1 && <select className={`${field} w-auto`} value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Category"><option value="">All categories</option>{categories.map((name) => <option key={name}>{name}</option>)}</select>}
          <ShowChips show={show} setShow={setShow} />
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showRemoved} onChange={(event) => setShowRemoved(event.target.checked)} />Show removed</label>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!data.items.length ? <EmptyState text="No Entry Clerk has listed inventory yet. Each clerk adds their items from Inventory in their own menu." />
          : !groups.length ? <EmptyState text="No item matches these filters." />
            : groups.map((rows) => {
              const first = rows[0], live = rows.filter((item) => item.status === "Active");
              const checks = live.map((item) => item.lastCheckedOn);
              const oldest = checks.includes("") ? "" : checks.sort()[0];
              return <div key={`${first.branch}-${first.employeeId}`} className="space-y-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{first.branch} <span className="font-normal text-muted-foreground">· {first.employeeName || first.employeeId}</span></p>
                  <p className="text-xs text-muted-foreground">{live.length} item{live.length === 1 ? "" : "s"} · {live.length ? (oldest ? `all checked since ${formatDate(oldest)}` : "some never checked") : "none active"}</p>
                </div>
                <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-sm">
                  <thead className="bg-muted/50 text-left"><tr>{["Item", "Category", "Quantity", "Condition", "Unit cost", "Value", "Last checked", "Note"].map((heading) => <th key={heading} className="p-2.5 font-medium">{heading}</th>)}</tr></thead>
                  <tbody>{rows.map((item) => {
                    const removed = item.status === "Removed";
                    return <tr key={item.id} className={`border-t align-top ${removed ? "bg-muted/40 text-muted-foreground" : ""}`}>
                      <td className="p-2.5"><span className={`font-medium ${removed ? "line-through" : ""}`}>{item.name}</span>{removed && <span className="block text-xs">Removed: {item.removedReason}</span>}</td>
                      <td className="p-2.5">{item.category || "—"}</td>
                      <td className="p-2.5 tabular-nums"><span className="font-semibold">{item.quantity.toLocaleString()}</span> {item.unit || "pcs"}{isLowStock(item) && !removed && <span className="mt-1 block"><StatusBadge status={`Low (alert at ${item.minQuantity})`} tone="warning" /></span>}</td>
                      <td className="p-2.5"><StatusBadge status={item.condition} tone={conditionTone[item.condition]} /></td>
                      <td className="p-2.5 tabular-nums">{item.unitCost === null ? "—" : formatPeso(item.unitCost)}</td>
                      <td className="p-2.5 tabular-nums">{item.unitCost === null ? "—" : formatPeso(itemValue(item))}</td>
                      <td className={`p-2.5 ${!removed && checkOverdue(item.lastCheckedOn, data.today) ? "font-medium text-amber-700 dark:text-amber-400" : ""}`}>{item.lastCheckedOn ? formatDate(item.lastCheckedOn) : "Never"}</td>
                      <td className="p-2.5 text-xs">{item.note || "—"}</td>
                    </tr>;
                  })}</tbody>
                </table></div>
              </div>;
            })}
      </CardContent>
    </Card>
  </>;
}

// ---------------------------------------------------------------- shared

function ShowChips({ show, setShow }: { show: Show; setShow: (value: Show) => void }) {
  const options: Array<[Show, string]> = [["all", "All"], ["attention", "Needs attention"], ["low", "Low stock"], ["unchecked", "Not checked lately"]];
  return <div className="flex flex-wrap gap-1" role="group" aria-label="Show">
    {options.map(([value, label]) => <button key={value} type="button" aria-pressed={show === value} onClick={() => setShow(value)}
      className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${show === value ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
  </div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground"><Boxes className="size-8 opacity-40" />{text}</div>;
}

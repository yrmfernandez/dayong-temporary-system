"use client";

import { useState } from "react";
import { CheckSquare, Square, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProgramCategory } from "./program-categories";

type Field = "category" | "status" | "newSaleAmount" | "collectionAmount" | "flexible" | "maximum" | "registration" | "age" | "saleIncentive";
const FIELD_LABELS: Record<Field, string> = {
  category: "Category", status: "Status", newSaleAmount: "New Sale amount", collectionAmount: "Collection amount", flexible: "Flexible payments",
  maximum: "Monthly maximum", registration: "Registration fee", age: "Age restriction", saleIncentive: "New Sale incentive",
};
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm";

/**
 * Select-all bar and the "Edit selected" panel of the Programs page. Only the settings ticked under "Change" are
 * applied, to every selected program at once; the server checks each program and saves all or nothing.
 */
export function ProgramBulkEdit({ allIds, selected, onSelectedChange, categories, onSaved }: {
  allIds: string[];
  selected: string[];
  onSelectedChange: (ids: string[]) => void;
  categories: ProgramCategory[];
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<Set<Field>>(new Set());
  const [values, setValues] = useState({
    categoryId: "", status: "active", newSaleAmountEditable: "no", collectionAmountEditable: "no", flexible: "no", maxMonthlyPayment: "",
    registrationRequired: "no", registrationAmount: "", ageRestricted: "no", minAge: "", maxAge: "", saleIncentiveType: "", saleIncentiveAmount: "",
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  // allIds are the programs the search shows: Select all adds them, Deselect all removes them, others stay selected.
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.includes(id));
  const set = (key: keyof typeof values, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const toggleField = (field: Field) => setFields((current) => { const next = new Set(current); if (next.has(field)) next.delete(field); else next.add(field); return next; });

  async function apply() {
    const changes: Record<string, unknown> = {};
    if (fields.has("category")) changes.categoryId = values.categoryId;
    if (fields.has("status")) changes.status = values.status;
    if (fields.has("newSaleAmount")) changes.newSaleAmountEditable = values.newSaleAmountEditable === "yes";
    if (fields.has("collectionAmount")) changes.collectionAmountEditable = values.collectionAmountEditable === "yes";
    if (fields.has("flexible")) changes.flexible = values.flexible === "yes";
    if (fields.has("maximum")) changes.maxMonthlyPayment = values.maxMonthlyPayment.trim() === "" ? null : Number(values.maxMonthlyPayment);
    if (fields.has("registration")) changes.registration = { required: values.registrationRequired === "yes", amount: Number(values.registrationAmount) || 0 };
    if (fields.has("age")) changes.age = { restricted: values.ageRestricted === "yes", minAge: values.minAge, maxAge: values.maxAge };
    if (fields.has("saleIncentive")) changes.saleIncentive = { type: values.saleIncentiveType, amount: Number(values.saleIncentiveAmount) || 0 };
    const summary = [...fields].map((field) => FIELD_LABELS[field]).join(", ");
    if (!window.confirm(`Change ${summary} on ${selected.length} program${selected.length === 1 ? "" : "s"}?`)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/programs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: selected, changes }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to update the programs.");
      setMessage({ tone: "success", text: `Updated ${result.updated} program${result.updated === 1 ? "" : "s"}: ${summary}.` });
      setFields(new Set()); setOpen(false); onSelectedChange([]);
      await onSaved();
    } catch (failure) { setMessage({ tone: "error", text: failure instanceof Error ? failure.message : "Unable to update the programs." }); }
    finally { setBusy(false); }
  }

  /** One setting: the "Change" tick on the left, its inputs (enabled only when ticked) on the right. */
  const row = (field: Field, control: React.ReactNode, hint?: string) => (
    <div className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-center ${fields.has(field) ? "border-primary/50 bg-primary/5" : ""}`}>
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={fields.has(field)} onChange={() => toggleField(field)} />
        {FIELD_LABELS[field]}
      </label>
      <div className={fields.has(field) ? "" : "pointer-events-none opacity-50"} aria-disabled={!fields.has(field)}>
        {control}
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  );
  const yesNo = (key: keyof typeof values, yes: string, no: string) => (
    <select className={selectClass} value={values[key]} onChange={(event) => set(key, event.target.value)}><option value="yes">{yes}</option><option value="no">{no}</option></select>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2">
        <button type="button" className="flex items-center gap-2 text-sm font-medium" onClick={() => onSelectedChange(allSelected ? selected.filter((id) => !allIds.includes(id)) : [...new Set([...selected, ...allIds])])} aria-pressed={allSelected}>
          {allSelected ? <CheckSquare className="size-4 text-primary" /> : <Square className="size-4 text-muted-foreground" />}
          {allSelected ? "Deselect all" : "Select all"}{allIds.length ? ` (${allIds.length})` : ""}
        </button>
        <span className="text-sm text-muted-foreground">{selected.length ? `${selected.length} selected` : "Tick programs to edit several at once"}</span>
        <div className="ml-auto flex gap-2">
          {selected.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onSelectedChange([])}><X className="mr-1 size-4" />Clear</Button>}
          <Button type="button" size="sm" disabled={!selected.length} onClick={() => { setOpen(!open); setMessage(null); }}><SlidersHorizontal className="mr-1.5 size-4" />{open ? "Close" : "Edit selected"}</Button>
        </div>
      </div>

      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-3 text-sm ${message.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{message.text}</p>}

      {open && selected.length > 0 && (
        <div className="space-y-3 rounded-xl border p-4">
          <div>
            <p className="font-semibold">Edit {selected.length} selected program{selected.length === 1 ? "" : "s"}</p>
            <p className="text-xs text-muted-foreground">Tick a setting to change it on every selected program; unticked settings stay as they are. Code, name, base pay, total payable and incentive periods are edited per program.</p>
          </div>
          {row("category", <select className={selectClass} value={values.categoryId} onChange={(event) => set("categoryId", event.target.value)}><option value="">No category</option>{categories.filter((category) => category.status === "active").map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>)}
          {row("status", <select className={selectClass} value={values.status} onChange={(event) => set("status", event.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option></select>, "Inactive programs cannot be chosen for new enrollments.")}
          {row("newSaleAmount", yesNo("newSaleAmountEditable", "Encoders may type the amount", "Locked to the program amount"))}
          {row("collectionAmount", yesNo("collectionAmountEditable", "Encoders may type the amount", "Locked to the program amount"))}
          {row("flexible", yesNo("flexible", "Yes: base pay is the minimum monthly payment", "No: fixed monthly payment"), "Turning it off removes any monthly maximum.")}
          {row("maximum", <Input type="number" min={0} step="0.01" placeholder="Blank = no maximum" value={values.maxMonthlyPayment} onChange={(event) => set("maxMonthlyPayment", event.target.value)} />, "Flexible programs only; must be at least each program's base pay.")}
          {row("registration", <div className="grid gap-2 sm:grid-cols-2">{yesNo("registrationRequired", "Required", "Not required")}<Input type="number" min={0} step="0.01" placeholder="Registration amount" disabled={values.registrationRequired !== "yes"} value={values.registrationAmount} onChange={(event) => set("registrationAmount", event.target.value)} /></div>)}
          {row("age", <div className="grid gap-2 sm:grid-cols-3">{yesNo("ageRestricted", "Restricted", "No age limit")}<Input type="number" min={0} max={120} placeholder="Minimum age" disabled={values.ageRestricted !== "yes"} value={values.minAge} onChange={(event) => set("minAge", event.target.value)} /><Input type="number" min={0} max={120} placeholder="Maximum (blank = none)" disabled={values.ageRestricted !== "yes"} value={values.maxAge} onChange={(event) => set("maxAge", event.target.value)} /></div>)}
          {row("saleIncentive", <div className="grid gap-2 sm:grid-cols-2"><select className={selectClass} value={values.saleIncentiveType} onChange={(event) => set("saleIncentiveType", event.target.value)}><option value="">None</option><option value="fixed">Fixed amount</option><option value="percentage">Percentage</option></select><Input type="number" min={0} step="0.01" placeholder="Amount or %" disabled={!values.saleIncentiveType} value={values.saleIncentiveAmount} onChange={(event) => set("saleIncentiveAmount", event.target.value)} /></div>, "Applies to programs with a registration fee.")}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button type="button" disabled={busy || !fields.size} onClick={() => void apply()}>{busy ? "Saving..." : `Apply to ${selected.length} program${selected.length === 1 ? "" : "s"}`}</Button>
            <Button type="button" variant="ghost" onClick={() => { setOpen(false); setFields(new Set()); }}>Cancel</Button>
            {!fields.size && <span className="text-xs text-muted-foreground">Tick at least one setting.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

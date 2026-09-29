"use client";

import { FormEvent, Fragment, useCallback, useEffect, useState } from "react";
import { CreditCard } from "lucide-react";

import { InlinePanel } from "@/components/inline-panel";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Method = { id: string; name: string; isCash: boolean; requiresReference: boolean; status: "active" | "inactive" };
const empty: Method = { id: "", name: "", isCash: false, requiresReference: true, status: "active" };

/** Administrators manage the remittance methods offered in Collections. */
export function RemittanceMethodSettings() {
  const [methods, setMethods] = useState<Method[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [form, setForm] = useState<Method>(empty);
  // An existing method is edited in place, under its own row; the top form only adds new ones.
  const [editing, setEditing] = useState<Method | null>(null);
  const [savedId, setSavedId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/remittance-methods", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message); return; }
    setMethods(result.methods ?? []); setCanManage(Boolean(result.canManage));
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(values: Method, done: () => void) {
    setBusy(true); setMessage("");
    const response = await fetch("/api/remittance-methods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(values) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.message); return; }
    setSavedId(values.id); setMessage(`${result.method.name} saved.`); done(); await load();
  }

  const fields = (values: Method, change: (next: Method) => void, onSubmit: (event: FormEvent) => void, extra?: React.ReactNode) => (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-[1.4fr_auto_auto_auto_auto] sm:items-end">
      <div className="space-y-2"><Label htmlFor={`method-name-${values.id || "new"}`}>{values.id ? "Method name" : "New method"}</Label><Input id={`method-name-${values.id || "new"}`} required maxLength={60} placeholder="e.g. Maya" value={values.name} onChange={(event) => change({ ...values, name: event.target.value })} /></div>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={values.isCash} onChange={(event) => change({ ...values, isCash: event.target.checked, requiresReference: event.target.checked ? false : values.requiresReference })} />Physical cash</label>
      <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" disabled={values.isCash} checked={values.requiresReference} onChange={(event) => change({ ...values, requiresReference: event.target.checked })} />Requires reference no.</label>
      <select aria-label="Status" className="h-10 rounded-md border bg-background px-3 text-sm" value={values.status} onChange={(event) => change({ ...values, status: event.target.value as Method["status"] })}><option value="active">Active</option><option value="inactive">Inactive</option></select>
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving..." : values.id ? "Save" : "Add"}</Button>{extra}</div>
    </form>
  );

  if (!canManage) return null;
  return <Card>
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="tone-soft tone-teal rounded-lg p-2"><CreditCard className="size-5" /></div>
        <div><CardTitle>Remittance Methods</CardTitle><CardDescription>Options offered in Collections for how a MAS remits a batch. Deactivate instead of deleting so past records keep their method.</CardDescription></div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      {fields(form, setForm, (event) => { event.preventDefault(); setEditing(null); void save(form, () => setForm(empty)); })}
      {message && !editing && !savedId && <p className="text-sm" role="status">{message}</p>}
      <div className="divide-y rounded-lg border">
        {methods.map((method) => <Fragment key={method.id}>
          <button type="button" aria-expanded={editing?.id === method.id} onClick={() => { setMessage(""); setSavedId(""); setEditing((current) => current?.id === method.id ? null : method); }} className={`flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted/50 ${editing?.id === method.id ? "bg-muted/50" : ""}`}>
            <span><strong>{method.name}</strong> <span className="text-muted-foreground">· {method.isCash ? "Physical cash" : method.requiresReference ? "Reference required" : "No reference"}</span></span>
            <StatusBadge status={method.status} />
          </button>
          {savedId === method.id && !editing && message && <p role="status" className="bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
          {editing?.id === method.id && <div className="p-2"><InlinePanel>
            {fields(editing, setEditing, (event) => { event.preventDefault(); void save(editing, () => setEditing(null)); }, <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>)}
            {message && <p className="mt-3 text-sm" role="status">{message}</p>}
          </InlinePanel></div>}
        </Fragment>)}
        {!methods.length && <p className="p-3 text-sm text-muted-foreground">No remittance methods yet.</p>}
      </div>
    </CardContent>
  </Card>;
}

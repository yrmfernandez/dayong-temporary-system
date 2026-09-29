"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { CreditCard } from "lucide-react";

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
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/remittance-methods", { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) { setMessage(result.message); return; }
    setMethods(result.methods ?? []); setCanManage(Boolean(result.canManage));
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    const response = await fetch("/api/remittance-methods", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const result = await response.json();
    setBusy(false);
    if (!response.ok) { setMessage(result.message); return; }
    setMessage(`${result.method.name} saved.`); setForm(empty); await load();
  }

  if (!canManage) return null;
  return <Card>
    <CardHeader>
      <div className="flex items-center gap-3">
        <div className="tone-soft tone-teal rounded-lg p-2"><CreditCard className="size-5" /></div>
        <div><CardTitle>Remittance Methods</CardTitle><CardDescription>Options offered in Collections for how a MAS remits a batch. Deactivate instead of deleting so past records keep their method.</CardDescription></div>
      </div>
    </CardHeader>
    <CardContent className="space-y-4">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-[1.4fr_auto_auto_auto_auto] sm:items-end">
        <div className="space-y-2"><Label htmlFor="payment-method-name">{form.id ? "Edit method" : "New method"}</Label><Input id="payment-method-name" required maxLength={60} placeholder="e.g. Maya" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" checked={form.isCash} onChange={(event) => setForm({ ...form, isCash: event.target.checked, requiresReference: event.target.checked ? false : form.requiresReference })} />Physical cash</label>
        <label className="flex h-10 items-center gap-2 text-sm"><input type="checkbox" disabled={form.isCash} checked={form.requiresReference} onChange={(event) => setForm({ ...form, requiresReference: event.target.checked })} />Requires reference no.</label>
        <select aria-label="Status" className="h-10 rounded-md border bg-background px-3 text-sm" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as Method["status"] })}><option value="active">Active</option><option value="inactive">Inactive</option></select>
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving..." : form.id ? "Save" : "Add"}</Button>{form.id && <Button type="button" variant="ghost" onClick={() => setForm(empty)}>Cancel</Button>}</div>
      </form>
      {message && <p className="text-sm" role="status">{message}</p>}
      <div className="divide-y rounded-lg border">
        {methods.map((method) => <button type="button" key={method.id} onClick={() => setForm(method)} className="flex w-full flex-wrap items-center justify-between gap-2 p-3 text-left text-sm hover:bg-muted/50">
          <span><strong>{method.name}</strong> <span className="text-muted-foreground">· {method.isCash ? "Physical cash" : method.requiresReference ? "Reference required" : "No reference"}</span></span>
          <StatusBadge status={method.status} />
        </button>)}
        {!methods.length && <p className="p-3 text-sm text-muted-foreground">No remittance methods yet.</p>}
      </div>
    </CardContent>
  </Card>;
}

"use client";
import { FormEvent, Fragment, useEffect, useState } from "react";
import { InlinePanel } from "@/components/inline-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Account = { id: string; name: string; type: string; openingBalance: number; status: string };
type AccountForm = { id: string; name: string; type: string; openingBalance: string; status: string };
const blank: AccountForm = { id: "", name: "", type: "Cash on Hand", openingBalance: "0", status: "active" };

export function FinanceSettings() {
  const [accounts, setAccounts] = useState<Account[]>([]), [allowed, setAllowed] = useState(false), [message, setMessage] = useState("");
  // New accounts use the form at the top; an existing account is edited in place, under its own row.
  const [form, setForm] = useState<AccountForm>(blank), [editing, setEditing] = useState<AccountForm | null>(null), [savedId, setSavedId] = useState("");
  async function load() { const r = await fetch("/api/finance-options", { cache: "no-store" }); if (r.status === 403) return; const j = await r.json(); if (r.ok) { setAllowed(true); setAccounts(j.accounts ?? []); } }
  useEffect(() => { void load(); }, []);
  async function save(values: AccountForm, done: () => void) {
    const r = await fetch("/api/finance-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...values, openingBalance: Number(values.openingBalance) }) }), j = await r.json();
    if (!r.ok) { setMessage(j.message); return; }
    setSavedId(values.id); setMessage("Cash account saved."); done(); await load();
  }
  const fields = (values: AccountForm, change: (next: AccountForm) => void, onSubmit: (event: FormEvent) => void, extra?: React.ReactNode) => (
    <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-4">
      <div><Label>Account name</Label><Input value={values.name} onChange={(e) => change({ ...values, name: e.target.value })} /></div>
      <div><Label>Type</Label><select className="h-9 w-full rounded-md border bg-background px-3" value={values.type} onChange={(e) => change({ ...values, type: e.target.value })}>{["Cash on Hand", "Bank", "E-wallet"].map((x) => <option key={x}>{x}</option>)}</select></div>
      <div><Label>Opening balance</Label><Input type="number" step="0.01" value={values.openingBalance} onChange={(e) => change({ ...values, openingBalance: e.target.value })} /></div>
      <div className="flex items-end gap-2"><Button type="submit">Save account</Button>{extra}</div>
    </form>
  );
  if (!allowed) return null;
  return <Card>
    <CardHeader><CardTitle>Finance cash accounts</CardTitle><CardDescription>Managed account names used by Expenses, Cash Transactions, and Vendor Payables. Click an account to edit it.</CardDescription></CardHeader>
    <CardContent className="space-y-4">
      {fields(form, setForm, (e) => { e.preventDefault(); setEditing(null); void save(form, () => setForm(blank)); })}
      {message && !editing && !savedId && <p className="text-sm">{message}</p>}
      <div className="divide-y rounded-lg border">{accounts.map((x) => <Fragment key={x.id}>
        <button type="button" aria-expanded={editing?.id === x.id} className={`flex w-full justify-between p-3 text-left text-sm hover:bg-muted/50 ${editing?.id === x.id ? "bg-muted/50" : ""}`} onClick={() => { setMessage(""); setSavedId(""); setEditing((current) => current?.id === x.id ? null : { id: x.id, name: x.name, type: x.type, openingBalance: String(x.openingBalance), status: x.status }); }}>
          <span><b>{x.name}</b> · {x.type}</span><span>{x.status} · ₱{x.openingBalance.toFixed(2)}</span>
        </button>
        {savedId === x.id && !editing && message && <p role="status" className="bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
        {editing?.id === x.id && <div className="p-2"><InlinePanel>
          {fields(editing, setEditing, (e) => { e.preventDefault(); void save(editing, () => setEditing(null)); }, <Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>)}
          {message && <p className="mt-3 text-sm" role="status">{message}</p>}
        </InlinePanel></div>}
      </Fragment>)}</div>
    </CardContent>
  </Card>;
}

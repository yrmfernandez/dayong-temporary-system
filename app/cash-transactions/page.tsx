"use client";

import { FormEvent, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronUp, Plus, Trash2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

 type CashTransaction = {
  id: string;
  date: string;
  type: "inflow" | "outflow";
  category: string;
  description: string;
  amount: number;
  reference: string;
};

type CashForm = Omit<CashTransaction, "id" | "amount"> & { amount: string };

const emptyForm: CashForm = { date: "", type: "inflow", category: "", description: "", amount: "", reference: "" };
const money = (value: number) => `PHP ${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function CashTransactionsPage() {
  const [transactions, setTransactions] = useState<CashTransaction[]>([]);
  const [form, setForm] = useState<CashForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [expandedTransactions, setExpandedTransactions] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  const inflow = transactions.filter((item) => item.type === "inflow").reduce((sum, item) => sum + item.amount, 0);
  const outflow = transactions.filter((item) => item.type === "outflow").reduce((sum, item) => sum + item.amount, 0);

  const addTransaction = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(form.amount);

    if (!form.date || !form.category || !form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage("Complete the required fields with an amount greater than zero.");
      return;
    }

    setTransactions((current) => [{ ...form, id: `CASH-${Date.now()}`, amount, description: form.description.trim(), reference: form.reference.trim() }, ...current]);
    setForm(emptyForm);
    setShowForm(false);
    setMessage("Cash transaction added to this session.");
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cash Transactions</h1>
          <p className="text-sm text-muted-foreground">Track cash coming in and going out of the business.</p>
        </div>
        <Button type="button" onClick={() => setShowForm(true)}><Plus className="mr-2 size-4" />Add Transaction</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Cash inflow</p><p className="mt-1 text-2xl font-semibold text-emerald-700">{money(inflow)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Cash outflow</p><p className="mt-1 text-2xl font-semibold text-red-700">{money(outflow)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Net movement</p><p className="mt-1 text-2xl font-semibold">{money(inflow - outflow)}</p></CardContent></Card>
      </div>

      {showForm && <Card><CardHeader><CardTitle>New cash transaction</CardTitle></CardHeader><CardContent><form className="space-y-4" onSubmit={addTransaction}><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><div className="space-y-2"><Label htmlFor="cash-date">Date *</Label><Input id="cash-date" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></div><div className="space-y-2"><Label htmlFor="cash-type">Direction *</Label><select id="cash-type" className="block h-9 w-full rounded-lg border bg-background px-3 text-sm" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as CashForm["type"] }))}><option value="inflow">Cash inflow</option><option value="outflow">Cash outflow</option></select></div><div className="space-y-2"><Label htmlFor="cash-amount">Amount *</Label><Input id="cash-amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div><div className="space-y-2"><Label htmlFor="cash-category">Category *</Label><Input id="cash-category" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Collection, deposit, withdrawal" /></div><div className="space-y-2"><Label htmlFor="cash-reference">Reference</Label><Input id="cash-reference" value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} placeholder="OR number or reference" /></div><div className="space-y-2 md:col-span-2 lg:col-span-1"><Label htmlFor="cash-description">Description *</Label><Input id="cash-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="Transaction details" /></div></div>{message && <p className="text-sm text-muted-foreground">{message}</p>}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => { setShowForm(false); setMessage(""); }}>Cancel</Button><Button type="submit">Save Transaction</Button></div></form></CardContent></Card>}

      <Card><CardHeader><CardTitle>Cash ledger</CardTitle></CardHeader><CardContent>{transactions.length === 0 ? <div className="rounded-lg border border-dashed p-10 text-center"><Wallet className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No cash transactions recorded yet.</p><p className="text-sm text-muted-foreground">Add a transaction to start the ledger.</p></div> : <div className="divide-y rounded-lg border">{transactions.map((transaction) => { const expanded = expandedTransactions[transaction.id] ?? false; const isInflow = transaction.type === "inflow"; return <div key={transaction.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3">{isInflow ? <ArrowDownLeft className="mt-0.5 size-5 text-emerald-600" /> : <ArrowUpRight className="mt-0.5 size-5 text-red-600" />}<div><p className="font-medium">{transaction.description}</p><p className="text-sm text-muted-foreground">{transaction.category} · {transaction.date}</p></div></div><div className="flex items-center gap-2"><span className={`font-semibold ${isInflow ? "text-emerald-700" : "text-red-700"}`}>{isInflow ? "+" : "-"}{money(transaction.amount)}</span><Button type="button" variant="outline" size="icon" aria-expanded={expanded} aria-label={expanded ? "Collapse transaction details" : "Expand transaction details"} onClick={() => setExpandedTransactions((current) => ({ ...current, [transaction.id]: !expanded }))}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button><Button type="button" variant="ghost" size="icon" aria-label="Delete transaction" onClick={() => setTransactions((current) => current.filter((item) => item.id !== transaction.id))}><Trash2 /></Button></div></div>{expanded && <div className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-2"><div><p className="text-muted-foreground">Transaction ID</p><p>{transaction.id}</p></div><div><p className="text-muted-foreground">Reference</p><p>{transaction.reference || "Not recorded"}</p></div></div>}</div>; })}</div>}</CardContent></Card>
    </section>
  );
}

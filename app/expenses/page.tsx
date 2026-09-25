"use client";

import { FormEvent, useState } from "react";
import { ChevronDown, ChevronUp, Plus, Receipt, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

 type Expense = {
  id: string;
  date: string;
  category: string;
  description: string;
  amount: number;
  paidBy: string;
  branch: string;
};

type ExpenseForm = Omit<Expense, "id" | "amount"> & { amount: string };

const emptyForm: ExpenseForm = {
  date: "",
  category: "",
  description: "",
  amount: "",
  paidBy: "",
  branch: "",
};

const money = (value: number) =>
  `PHP ${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export default function ExpensesPage() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [expandedExpenses, setExpandedExpenses] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState("");

  const total = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  const addExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(form.amount);

    if (!form.date || !form.category || !form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setMessage("Complete the required fields with an amount greater than zero.");
      return;
    }

    const expense: Expense = {
      ...form,
      id: `EXP-${Date.now()}`,
      amount,
      description: form.description.trim(),
      paidBy: form.paidBy.trim(),
      branch: form.branch.trim(),
    };

    setExpenses((current) => [expense, ...current]);
    setForm(emptyForm);
    setShowForm(false);
    setMessage("Expense added to this session.");
  };

  const removeExpense = (id: string) => {
    setExpenses((current) => current.filter((expense) => expense.id !== id));
  };

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">Record and review operating expenses.</p>
        </div>
        <Button type="button" onClick={() => setShowForm(true)}>
          <Plus className="mr-2 size-4" />
          Add Expense
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Total expenses</p><p className="mt-1 text-2xl font-semibold">{money(total)}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Entries</p><p className="mt-1 text-2xl font-semibold">{expenses.length}</p></CardContent></Card>
        <Card><CardContent className="pt-5"><p className="text-sm text-muted-foreground">Average expense</p><p className="mt-1 text-2xl font-semibold">{money(expenses.length ? total / expenses.length : 0)}</p></CardContent></Card>
      </div>

      {showForm && (
        <Card>
          <CardHeader><CardTitle>New expense</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={addExpense}>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-2"><Label htmlFor="expense-date">Date *</Label><Input id="expense-date" type="date" value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></div>
                <div className="space-y-2"><Label htmlFor="expense-category">Category *</Label><Input id="expense-category" value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Utilities, supplies, transport" /></div>
                <div className="space-y-2"><Label htmlFor="expense-amount">Amount *</Label><Input id="expense-amount" type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" /></div>
                <div className="space-y-2"><Label htmlFor="expense-paid-by">Paid by</Label><Input id="expense-paid-by" value={form.paidBy} onChange={(event) => setForm((current) => ({ ...current, paidBy: event.target.value }))} placeholder="Person or account" /></div>
                <div className="space-y-2"><Label htmlFor="expense-branch">Branch</Label><Input id="expense-branch" value={form.branch} onChange={(event) => setForm((current) => ({ ...current, branch: event.target.value }))} placeholder="Branch name" /></div>
                <div className="space-y-2 md:col-span-2 lg:col-span-1"><Label htmlFor="expense-description">Description *</Label><Input id="expense-description" value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What was purchased?" /></div>
              </div>
              {message && <p className="text-sm text-muted-foreground">{message}</p>}
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={() => { setShowForm(false); setMessage(""); }}>Cancel</Button><Button type="submit">Save Expense</Button></div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Expense register</CardTitle></CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <div className="rounded-lg border border-dashed p-10 text-center"><Receipt className="mx-auto size-8 text-muted-foreground" /><p className="mt-3 font-medium">No expenses recorded yet.</p><p className="text-sm text-muted-foreground">Add an expense to start the register.</p></div>
          ) : (
            <div className="divide-y rounded-lg border">
              {expenses.map((expense) => {
                const expanded = expandedExpenses[expense.id] ?? false;
                return <div key={expense.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{expense.description}</p><p className="text-sm text-muted-foreground">{expense.category} · {expense.date}</p></div><div className="flex items-center gap-2"><span className="font-semibold">{money(expense.amount)}</span><Button type="button" variant="outline" size="icon" aria-expanded={expanded} aria-label={expanded ? "Collapse expense details" : "Expand expense details"} onClick={() => setExpandedExpenses((current) => ({ ...current, [expense.id]: !expanded }))}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button><Button type="button" variant="ghost" size="icon" aria-label="Delete expense" onClick={() => removeExpense(expense.id)}><Trash2 /></Button></div></div>{expanded && <div className="mt-4 grid gap-3 border-t pt-4 text-sm sm:grid-cols-3"><div><p className="text-muted-foreground">Expense ID</p><p>{expense.id}</p></div><div><p className="text-muted-foreground">Paid by</p><p>{expense.paidBy || "Not recorded"}</p></div><div><p className="text-muted-foreground">Branch</p><p>{expense.branch || "Not recorded"}</p></div></div>}</div>;
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

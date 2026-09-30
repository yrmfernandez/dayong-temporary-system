"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Progress = { key: string; label: string; achieved: number; accounts: number; target: number; accountsTarget: number; notes: string; elapsed: number; projected: number };
const peso = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 0 }).format(value);

/** Gross Sales against the quarter and year targets, with pace, and an inline form to set them. */
export function CompanyTargets({ targets, className = "" }: { targets: Progress[]; className?: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ grossSales: "", newAccounts: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function edit(item: Progress) {
    setEditing(item.key); setError("");
    setForm({ grossSales: item.target ? String(item.target) : "", newAccounts: item.accountsTarget ? String(item.accountsTarget) : "", notes: item.notes });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/company-targets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: editing, ...form }) });
      const result = await response.json();
      if (!result.success) throw new Error(result.message);
      setEditing(null);
      router.refresh();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to save the target."); }
    finally { setSaving(false); }
  }

  return <Card className={className}>
    <CardHeader><CardTitle className="flex items-center gap-2"><Target className="size-4 text-primary" />Targets</CardTitle><p className="text-xs text-muted-foreground">Gross Sales to date against target</p></CardHeader>
    <CardContent className="space-y-5">
      {targets.map((item) => {
        const percent = item.target ? (item.achieved / item.target) * 100 : 0;
        const onPace = item.target ? item.projected >= item.target : null;
        return <div key={item.key} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-semibold">{item.label}</p><button type="button" onClick={() => edit(item)} className="text-xs font-medium text-primary hover:underline">{item.target ? "Edit target" : "Set target"}</button></div>
          {item.target ? <>
            <div className="viz relative h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${percent.toFixed(0)}% of target reached, ${item.elapsed.toFixed(0)}% of the period elapsed`}>
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, percent)}%`, background: "var(--viz-1)" }} />
              <span className="absolute inset-y-0 w-0.5 bg-foreground/70" style={{ left: `${item.elapsed}%` }} title="Where sales should be today to stay on pace" />
            </div>
            <p className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"><span><strong className="text-foreground tabular-nums">{peso(item.achieved)}</strong> of {peso(item.target)} · {percent.toFixed(0)}%</span><span className={onPace ? "font-semibold text-emerald-700 dark:text-emerald-400" : "font-semibold text-amber-700"}>{onPace ? "On pace" : "Behind pace"}: projected {peso(item.projected)}</span></p>
            {item.accountsTarget > 0 && <p className="text-xs text-muted-foreground">New accounts: <strong className="text-foreground tabular-nums">{item.accounts}</strong> of {item.accountsTarget}</p>}
          </> : <p className="text-xs text-muted-foreground">No target set. {peso(item.achieved)} so far, projected {peso(item.projected)} at the current pace.</p>}
          {editing === item.key && <form onSubmit={save} className="space-y-3 rounded-xl border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor={`gross-${item.key}`}>Gross Sales target (₱)</Label><Input id={`gross-${item.key}`} type="number" min="1" step="0.01" required value={form.grossSales} onChange={(event) => setForm({ ...form, grossSales: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor={`accounts-${item.key}`}>New accounts target</Label><Input id={`accounts-${item.key}`} type="number" min="0" step="1" value={form.newAccounts} onChange={(event) => setForm({ ...form, newAccounts: event.target.value })} /></div>
            </div>
            <div className="space-y-1"><Label htmlFor={`notes-${item.key}`}>Notes</Label><Input id={`notes-${item.key}`} maxLength={300} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex gap-2"><Button type="submit" size="sm" disabled={saving}>{saving ? "Saving..." : "Save target"}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
          </form>}
        </div>;
      })}
      <p className="text-xs text-muted-foreground">The line on each bar marks where sales should be today to hit the target at an even pace.</p>
    </CardContent>
  </Card>;
}

"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export type ProgramCategory = { id: string; name: string; status: "active" | "inactive"; description: string };

/** Add, rename, deactivate or delete program categories (Pay the Balance, Funeral Services, Cash Assistance, ...). */
export function ProgramCategoriesManager({ categories, onChanged }: { categories: ProgramCategory[]; onChanged: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  async function send(method: "POST" | "PUT" | "DELETE", body: Record<string, unknown> | null, id: string, success: string) {
    setBusy(true); setMessage(null);
    try {
      const response = await fetch(`/api/program-categories${id ? `?id=${encodeURIComponent(id)}` : ""}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || "Unable to save the category.");
      setMessage({ tone: "success", text: success }); setName(""); setEditing(null); await onChanged();
    } catch (failure) { setMessage({ tone: "error", text: failure instanceof Error ? failure.message : "Unable to save the category." }); }
    finally { setBusy(false); }
  }

  return <Card>
    <CardHeader><CardTitle>Program Categories</CardTitle><p className="text-sm text-muted-foreground">Group programs by what they provide. Renaming a category updates every program in it.</p></CardHeader>
    <CardContent className="space-y-3">
      <form className="flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void send("POST", { name }, "", `Category "${name.trim()}" added.`); }}>
        <Input className="max-w-xs" maxLength={60} placeholder="New category name" value={name} onChange={(event) => setName(event.target.value)} />
        <Button type="submit" disabled={busy || name.trim().length < 2}><Plus className="mr-2 size-4" />Add category</Button>
      </form>
      {message && <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-lg border p-2 text-sm ${message.tone === "error" ? "border-destructive/40 bg-destructive/5 text-destructive" : "border-emerald-300 bg-emerald-50 text-emerald-800"}`}>{message.text}</p>}
      <ul className="divide-y rounded-lg border">
        {categories.map((category) => <li key={category.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
          {editing?.id === category.id
            ? <form className="flex flex-1 flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); void send("PUT", { name: editing.name, status: category.status, description: category.description }, category.id, "Category renamed."); }}>
                <Input className="max-w-xs" maxLength={60} value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
                <Button type="submit" size="sm" disabled={busy || editing.name.trim().length < 2}>Save</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
              </form>
            : <span className="flex-1 font-medium">{category.name}{category.status === "inactive" && <span className="ml-2 text-xs font-normal text-muted-foreground">(inactive)</span>}</span>}
          {editing?.id !== category.id && <>
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing({ id: category.id, name: category.name })}><Pencil className="mr-1 size-4" />Rename</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void send("PUT", { name: category.name, status: category.status === "active" ? "inactive" : "active", description: category.description }, category.id, category.status === "active" ? "Category set to inactive." : "Category reactivated.")}>{category.status === "active" ? "Set inactive" : "Reactivate"}</Button>
            <Button type="button" size="sm" variant="ghost" className="text-destructive" disabled={busy} aria-label={`Delete ${category.name}`} onClick={() => { if (window.confirm(`Delete the category "${category.name}"?`)) void send("DELETE", null, category.id, "Category deleted."); }}><Trash2 className="size-4" /></Button>
          </>}
        </li>)}
        {!categories.length && <li className="p-4 text-center text-sm text-muted-foreground">No categories yet.</li>}
      </ul>
    </CardContent>
  </Card>;
}

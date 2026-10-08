"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { readApiResponse } from "@/lib/api-response";
import { MEMBER_STATUSES } from "@/lib/member-directory";
import type { MemberRecordInput } from "@/lib/master-data-crud";

const fieldClass = "mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm";
const GENDERS = ["Female", "Male"];
const CIVIL_STATUSES = ["Single", "Married", "Widowed", "Separated", "Live-in"];
const unique = (values: string[]) => [...new Set(values.filter(Boolean))];

/**
 * Every detail of a member, editable by an Administrator (October 8, 2026). Saving updates the copies on the member's
 * New Sale records, and a new PH number on their accounts and collections; the Audit Log keeps the previous values.
 */
export function MemberEditForm({ memberId, onCancel, onSaved }: { memberId: string; onCancel: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState<MemberRecordInput | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/members/directory?memberId=${encodeURIComponent(memberId)}`, { cache: "no-store" })
      .then(async (response) => { const result = await readApiResponse(response); if (!response.ok || !result.success) throw new Error(result.message || "Unable to load the member."); return result.member as MemberRecordInput; })
      .then((member) => { if (!cancelled) setForm(member); })
      .catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Unable to load the member."); });
    return () => { cancelled = true; };
  }, [memberId]);

  const set = <K extends keyof MemberRecordInput>(key: K, value: MemberRecordInput[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));
  const text = (key: keyof MemberRecordInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="text-sm">{label}<input className={fieldClass} value={String(form?.[key] ?? "")} onChange={(event) => set(key, event.target.value as never)} {...props} /></label>
  );

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/members/directory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: memberId, ...form }) });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to update the member.");
      onSaved("Member updated. Their New Sale records show the new details.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update the member."); }
    finally { setSaving(false); }
  }

  if (!form) return <div className="mt-4 border-t pt-4 text-sm">{error ? <p role="alert" className="text-red-700">{error}</p> : <p className="text-muted-foreground">Loading the member...</p>}</div>;
  return (
    <form className="mt-4 space-y-4 border-t pt-4" onSubmit={(event) => void save(event)}>
      <div className="flex justify-between"><h2 className="font-semibold">Edit member</h2><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Member</legend>
        {text("memberNumber", "PH member number *", { required: true })}
        {text("surname", "Surname *", { required: true })}
        {text("firstName", "First name *", { required: true })}
        {text("middleName", "Middle name")}
        {text("nameExtension", "Extension (Jr., Sr., III)")}
        {text("birthdate", "Birthdate", { type: "date", max: new Date().toISOString().slice(0, 10) })}
        {text("age", "Age", { type: "number", min: 0, max: 130, step: 1 })}
        {text("birthplace", "Birthplace")}
        <label className="text-sm">Sex<select className={fieldClass} value={form.gender} onChange={(event) => set("gender", event.target.value)}><option value="">Not recorded</option>{unique([...GENDERS, form.gender]).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Civil status<select className={fieldClass} value={form.civilStatus} onChange={(event) => set("civilStatus", event.target.value)}><option value="">Not recorded</option>{unique([...CIVIL_STATUSES, form.civilStatus]).map((value) => <option key={value}>{value}</option>)}</select></label>
        {text("contact", "Contact number")}
        <label className="text-sm">Member status *<select required className={fieldClass} value={form.status || "Active"} onChange={(event) => set("status", event.target.value)}>{unique([...MEMBER_STATUSES, form.status]).map((value) => <option key={value}>{value}</option>)}</select><span className="mt-1 block text-xs text-muted-foreground">Choose Deceased when the member has died.</span></label>
        <label className="text-sm sm:col-span-2 lg:col-span-4">Address<input className={fieldClass} value={form.address} onChange={(event) => set("address", event.target.value)} /></label>
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Claimant</legend>
        {text("claimantName", "Claimant name")}
        {text("claimantContact", "Claimant contact")}
        <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:mt-6"><input type="checkbox" checked={form.claimantSameAddress} onChange={(event) => set("claimantSameAddress", event.target.checked)} />Same address as the member</label>
        {!form.claimantSameAddress && <label className="text-sm sm:col-span-2 lg:col-span-4">Claimant address<input className={fieldClass} value={form.claimantAddress} onChange={(event) => set("claimantAddress", event.target.value)} /></label>}
      </fieldset>
      <p className="text-xs text-muted-foreground">Saving also updates these details on the member&apos;s New Sale records, and a new PH number on their accounts and collections. The previous values stay in the Audit Log. Program accounts (DOI, MAS, branch) are changed through Transfer or the entry corrections, not here.</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? "Saving..." : "Save member"}</Button>
    </form>
  );
}

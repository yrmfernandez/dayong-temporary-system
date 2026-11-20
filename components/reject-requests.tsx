"use client";

import { useState } from "react";

import { promptDialog } from "@/components/app-dialog";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseJsonResponse } from "@/lib/api-response";
import { formatDateTime } from "@/lib/date-format";
import type { RejectRequest } from "@/lib/entry-reject-requests";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);

/**
 * The Reject requests tab of Remittances (lib/entry-reject-requests.ts): what Entry Clerks asked to be rejected, with
 * their reasons. Accept rejects the entry's slip (its batch goes back to the clerk as Returned); Decline keeps it waiting
 * for approval, with a note for the clerk.
 */
export function RejectRequests({ requests, onViewSlip, onChanged }: { requests: RejectRequest[]; onViewSlip: (remittanceId: string) => void; onChanged: (message: string) => void }) {
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const pending = requests.filter((item) => item.status === "Pending");
  const decided = requests.filter((item) => item.status !== "Pending");

  const decide = async (item: RejectRequest, action: "accept" | "decline") => {
    let note = "";
    if (action === "decline") {
      note = (await promptDialog(`Why is the reject request for ${item.entryId} declined? The clerk sees this note; the entry stays waiting for approval.`, { required: true, title: "Decline reject request", confirmLabel: "Decline" })) ?? "";
      if (!note.trim()) return;
    }
    setSaving(item.id); setError("");
    try {
      const response = await fetch("/api/entry-reject-requests", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action, note }) });
      const result = await parseJsonResponse<{ success: boolean; message?: string }>(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to decide the request.");
      onChanged(result.message ?? "Done.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to decide the request."); }
    finally { setSaving(""); }
  };

  return <div className="space-y-6">
    <Card>
      <CardHeader>
        <CardTitle>Reject requests ({pending.length})</CardTitle>
        <p className="text-sm text-muted-foreground">Entries an Entry Clerk asked to be rejected, with the reason. <strong>Accept</strong> rejects the entry&apos;s remittance slip with that reason, so the whole batch goes back to the clerk as Returned to fix or remove the entry and resubmit. <strong>Decline</strong> leaves it waiting for approval, with your note for the clerk.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        {pending.map((item) => {
          const stale = item.entryStatus && item.entryStatus !== "Pending Remittance Approval";
          return <div key={item.id} className="rounded-lg border p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-semibold">{item.kind} <span className="font-mono">{item.entryId}</span> · {item.memberName || "—"} {item.memberNumber && <span className="font-normal text-muted-foreground">({item.memberNumber})</span>}</p>
                <p className="text-xs text-muted-foreground">{[item.reference, money(item.amount), item.branch].filter(Boolean).join(" · ")} · slip <button type="button" className="font-mono hover:underline" onClick={() => onViewSlip(item.remittanceId)}>{item.remittanceId}</button></p>
                <p className="text-xs text-muted-foreground">Asked by {item.requestedBy || "—"} · {formatDateTime(item.requestedAt)} · {item.id}</p>
                <p className="rounded-md bg-muted/50 px-2 py-1 text-sm"><span className="font-semibold">Reason:</span> {item.reason}</p>
                {stale && <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">{item.entryStatus === "Returned" ? "The slip was already returned to the clerk: Accept just closes this request." : item.entryStatus === "Remitted" ? "The slip was already approved: undo the approval first, or decline this and correct the entry in Edit / Corrections." : `The entry is now ${item.entryStatus}: decline this request.`}</p>}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button type="button" size="sm" disabled={Boolean(saving)} onClick={() => void decide(item, "accept")}>{saving === item.id ? "Saving..." : "Accept (return batch)"}</Button>
                <Button type="button" size="sm" variant="outline" disabled={Boolean(saving)} onClick={() => void decide(item, "decline")}>Decline</Button>
              </div>
            </div>
          </div>;
        })}
        {!pending.length && <p className="py-8 text-center text-sm text-muted-foreground">No reject requests are waiting.</p>}
      </CardContent>
    </Card>
    {decided.length > 0 && <Card>
      <CardHeader><CardTitle>Decided in the last 30 days ({decided.length})</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-lg border"><table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted/50 text-left"><tr>{["Request", "Entry", "Member", "Asked by", "Reason", "Decision", "Note"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
          <tbody>{decided.map((item) => <tr key={item.id} className="border-t align-top">
            <td className="p-3 font-mono text-xs">{item.id}<span className="block font-sans text-muted-foreground">{formatDateTime(item.requestedAt)}</span></td>
            <td className="p-3"><span className="font-mono text-xs">{item.entryId}</span><span className="block text-xs text-muted-foreground">{item.kind} · {money(item.amount)}</span></td>
            <td className="p-3">{item.memberName || "—"}<span className="block text-xs text-muted-foreground">{item.memberNumber}</span></td>
            <td className="p-3">{item.requestedBy || "—"}</td>
            <td className="p-3">{item.reason}</td>
            <td className="p-3"><StatusBadge status={item.status} tone={item.status === "Accepted" ? "danger" : "neutral"} /><span className="block text-xs text-muted-foreground">{item.reviewedBy}{item.reviewedAt ? ` · ${formatDateTime(item.reviewedAt)}` : ""}</span></td>
            <td className="p-3 text-xs">{item.reviewNote || "—"}</td>
          </tr>)}</tbody>
        </table></div>
      </CardContent>
    </Card>}
  </div>;
}

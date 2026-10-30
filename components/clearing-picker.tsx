"use client";

import { BadgeCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import { readApiResponse } from "@/lib/api-response";
import type { Clearing } from "@/lib/clearing";
import { coveredKinds, handoverLabel, type ClearingKind } from "@/lib/clearing-kinds";
import { useLiveRefresh } from "@/lib/use-live-refresh";

const time = (stamp: string) => { if (!stamp) return ""; const [hours, minutes] = stamp.slice(11, 16).split(":").map(Number); return `${((hours + 11) % 12) + 1}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`; };

/**
 * Batch information from Clearing (October 9, 2026): the encoder picks a person listed in Clearing and the batch's
 * Branch, MAS and Date Remitted (the clearing day) are filled in, so they always match the clearing the save checks
 * (lib/clearing.ts). Lists Open clearings and today's Encoded ones (a second batch the same day).
 */
export function ClearingPicker({ value, onPick, disabled, kind }: { value: string; onPick: (clearing: Clearing) => void; disabled?: boolean; kind: ClearingKind }) {
  const [clearings, setClearings] = useState<Clearing[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/clearing/open", { cache: "no-store" });
      const result = await readApiResponse(response);
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to load Clearing.");
      // Only clearings ticked for this kind (New Sales or Collections) can be encoded here.
      // An earlier day's Encoded clearing is listed only for the kind still waiting for encoding.
      setClearings(((result.clearings ?? []) as Clearing[]).filter((clearing) => coveredKinds(clearing.covers ?? "Both").includes(kind) && (!clearing.waitingKinds || clearing.waitingKinds.includes(kind)))); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to load Clearing."); }
  }, [kind]);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load
  useEffect(() => { void load(); }, [load]);
  // Live updates: a person cleared on another screen appears at once (lib/use-live-refresh.ts).
  useLiveRefresh(["clearings"], load);

  return <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
    <Label className="flex items-center gap-2"><BadgeCheck className="size-4 text-primary" />From Clearing *</Label>
    <SearchSelect aria-label="From Clearing" value={value} disabled={disabled} placeholder={clearings.length ? "Search the MAS or employee listed in Clearing" : `Nobody is in Clearing for ${kind} yet`}
      emptyText={`Nobody in Clearing for ${kind} matches. List them in Clearing (with ${kind} ticked) first.`}
      // Two handovers of one person the same day (October 29, 2026): the label says which one, with its time.
      // A handover whose batch is already saved goes last and says so (October 30, 2026): pick the other one.
      options={[...clearings].sort((a, b) => Number(Boolean(a.batchWaiting?.includes(kind))) - Number(Boolean(b.batchWaiting?.includes(kind)))).map((clearing) => ({ value: clearing.id, label: `${clearing.employeeName || clearing.employeeId}${(clearing.handovers ?? 0) > 1 ? ` · ${handoverLabel(clearing.handover ?? 1)} (${time(clearing.clearedAt)})` : ""}`, description: `${clearing.branch} · cleared ${clearing.clearedDate} ${time(clearing.clearedAt)}${clearing.batchWaiting?.includes(kind) ? ` · ${kind} batch already saved, waiting for approval` : clearing.waitingKinds ? ` · ${kind} not encoded yet` : clearing.status === "Encoded" ? " · already encoded once" : ""}`, keywords: clearing.employeeId }))}
      onValueChange={(id) => { const clearing = clearings.find((item) => item.id === id); if (clearing) onPick(clearing); }} />
    <p className="text-xs text-muted-foreground">{error || "Choose the person whose receipts were cleared; Branch, MAS and Date Remitted are filled in from the clearing. A person handed over twice today is listed once per handover: pick the one these receipts came with."}</p>
  </div>;
}

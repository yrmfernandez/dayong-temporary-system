"use client";

import { confirmDialog } from "@/components/app-dialog";
import { PauseCircle, PlayCircle, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatDateTime as showDateTime } from "@/lib/date-format";

const when = (stamp: string) => showDateTime(stamp);

/**
 * Set aside the open batch and pick up set-aside ones (lib/use-parked-drafts.ts): the clerk can leave a batch for a
 * moment, go on with other entries, and come back to it.
 */
export function ParkedDrafts({ drafts, canPark, onPark, onResume, onDelete }: {
  drafts: Array<{ id: string; label: string; savedAt: string }>;
  canPark: boolean;
  onPark: () => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Drafts{drafts.length ? ` (${drafts.length})` : ""}</p>
          <p className="text-xs text-muted-foreground">Set this batch aside to go on with other entries; resume it here later. Drafts stay in this browser until you sign out.</p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!canPark} onClick={onPark}><PauseCircle className="size-4" />Set this batch aside</Button>
      </div>
      {drafts.length > 0 && <ul className="divide-y rounded-md border bg-background">
        {drafts.map((draft) => <li key={draft.id} className="flex flex-wrap items-center justify-between gap-2 p-2 text-sm">
          <span className="min-w-0"><span className="block truncate font-medium">{draft.label}</span><span className="block text-xs text-muted-foreground">Set aside {when(draft.savedAt)}</span></span>
          <span className="flex gap-2">
            <Button type="button" size="sm" onClick={() => onResume(draft.id)}><PlayCircle className="size-4" />Resume</Button>
            <Button type="button" size="sm" variant="ghost" aria-label={`Delete draft ${draft.label}`} onClick={async () => { if (await confirmDialog(`Delete the draft "${draft.label}"? Its entries are not saved anywhere else.`)) onDelete(draft.id); }}><Trash2 className="size-4" /></Button>
          </span>
        </li>)}
      </ul>}
    </div>
  );
}

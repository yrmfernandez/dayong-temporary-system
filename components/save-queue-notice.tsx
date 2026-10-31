"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { oldestPendingSave, onSaveQueueChange } from "@/lib/save-queue";

/** Shown after a save has waited 2 s, until every waiting save is answered (lib/save-queue.ts). */
const SHOW_AFTER_MS = 2000;

export function SaveQueueNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      const oldest = oldestPendingSave();
      if (!oldest) { setVisible(false); return; }
      const wait = oldest + SHOW_AFTER_MS - Date.now();
      if (wait <= 0) setVisible(true);
      else timer = window.setTimeout(update, wait);
    };
    update();
    const stop = onSaveQueueChange(update);
    return () => { stop(); window.clearTimeout(timer); };
  }, []);
  if (!visible) return null;
  return (
    <div role="status" aria-live="polite" className="fixed inset-x-0 bottom-4 z-50 mx-auto flex w-[min(92vw,30rem)] items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-50">
      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
      <span><strong className="font-semibold">Saving, please wait...</strong> The system is busy, so your save is waiting in line. Do not close or refresh this page and do not press save again; this message goes away once it is saved.</span>
    </div>
  );
}

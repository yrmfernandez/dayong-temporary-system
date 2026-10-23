"use client";

import { AlertTriangle, Info, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * The app's own pop-up in place of the browser's window.confirm, window.prompt and alert (owner, October 21, 2026): a
 * box in the middle of the screen in the app's style. Call confirmDialog / promptDialog / alertDialog from anywhere in the
 * browser and await the answer, as with the browser's: confirm → true or false, prompt → the text or null when
 * cancelled, alert → when closed. <AppDialogHost /> (in the app shell) shows them one at a time, in order.
 */
type Options = {
  /** The heading; the message is shown under it. */
  title?: string;
  /** The OK button's text; by default the message's first word when it is an action ("Delete …" → Delete). */
  confirmLabel?: string;
  /** Red OK button; by default for Delete, Remove, Void, Reset, Withdraw, Release and Replace. */
  danger?: boolean;
  /** prompt only: the starting text. */
  defaultValue?: string;
  /** prompt only: OK stays off until something is typed. */
  required?: boolean;
  placeholder?: string;
  /** alert only: a warning (amber triangle, heading in capitals) the reader must acknowledge. */
  warning?: boolean;
  /** confirm and prompt: the Cancel button's text. */
  cancelLabel?: string;
  /** confirm: answered only with a button, not Escape or a click outside (the "no" button is itself an answer). */
  requireChoice?: boolean;
};
type Request = Options & { kind: "confirm" | "prompt" | "alert"; message: string; resolve: (value: boolean | string | null) => void };

const queue: Request[] = [];
let notify: (() => void) | null = null;

function ask(kind: Request["kind"], message: string, options: Options = {}) {
  return new Promise<boolean | string | null>((resolve) => {
    // No host on the page (should not happen): fall back to the browser's own box.
    if (!notify) return resolve(kind === "confirm" ? window.confirm(message) : kind === "prompt" ? window.prompt(message, options.defaultValue) : (window.alert(message), null));
    queue.push({ ...options, kind, message, resolve });
    notify();
  });
}

export const confirmDialog = (message: string, options?: Options) => ask("confirm", message, options) as Promise<boolean>;
export const promptDialog = (message: string, options?: Options) => ask("prompt", message, options) as Promise<string | null>;
export const alertDialog = (message: string, options?: Options) => ask("alert", message, options).then(() => undefined);

const ACTIONS = ["Delete", "Remove", "Void", "Reset", "Withdraw", "Release", "Replace", "Approve", "Reject", "Move", "Change", "Record", "Reopen"];
const DANGER = ["Delete", "Remove", "Void", "Reset", "Withdraw", "Release", "Replace", "Reject"];

export function AppDialogHost() {
  const [current, setCurrent] = useState<Request | null>(null);
  const [value, setValue] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const ok = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const next = () => setCurrent((shown) => {
      if (shown || !queue.length) return shown;
      const request = queue[0];
      setValue(request.defaultValue ?? "");
      return request;
    });
    notify = next;
    next();
    return () => { notify = null; };
  }, []);

  const close = (answer: boolean | string | null) => {
    if (!current) return;
    queue.shift();
    current.resolve(answer);
    setCurrent(null);
    // The next waiting box, after this one has gone.
    setTimeout(() => notify?.(), 0);
  };
  const cancel = () => close(current?.kind === "confirm" ? false : null);
  const accept = () => {
    if (!current) return;
    if (current.kind === "prompt") { if (current.required && !value.trim()) return; close(value); }
    else close(current.kind === "confirm" ? true : null);
  };

  useEffect(() => {
    if (!current) return;
    (current.kind === "prompt" ? input.current : ok.current)?.focus();
    input.current?.select();
    // A warning is closed only with its button, so it is acknowledged.
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !current.warning && !current.requireChoice) { event.preventDefault(); cancel(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cancel reads the current box
  }, [current]);

  if (!current) return null;
  const verb = current.message.trim().split(/\s/)[0];
  const action = current.confirmLabel ?? (current.kind === "alert" ? "OK" : ACTIONS.includes(verb) ? verb : "OK");
  const danger = current.danger ?? (current.kind === "confirm" && DANGER.includes(verb));
  const Icon = current.kind === "alert" && !current.warning ? Info : current.kind === "prompt" ? MessageSquare : AlertTriangle;
  const iconTone = danger ? "bg-destructive/10 text-destructive" : current.warning ? "bg-amber-500/15 text-amber-600 dark:text-amber-400" : "bg-primary/10 text-primary";

  return (
    // Centred on the screen over a dimmed, blurred page (owner, October 21, 2026: not at the top like the browser's).
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm animate-in fade-in duration-150" onMouseDown={(event) => { if (event.target === event.currentTarget && current.kind !== "alert" && !current.requireChoice) cancel(); }}>
      <form role={current.kind === "alert" ? "alertdialog" : "dialog"} aria-modal="true" aria-labelledby="app-dialog-message"
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl border bg-card p-5 text-card-foreground shadow-2xl animate-in fade-in zoom-in-95 duration-150"
        onSubmit={(event) => { event.preventDefault(); accept(); }}>
        <div className="flex gap-3">
          <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconTone}`}><Icon className="size-4" /></span>
          <div className="min-w-0 flex-1 space-y-1">
            {current.title && <p className={current.warning ? "font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400" : "font-semibold"}>{current.title}</p>}
            <p id="app-dialog-message" className="whitespace-pre-line break-words text-sm">{current.message}</p>
          </div>
        </div>
        {current.kind === "prompt" && <Input ref={input} className="mt-4" value={value} placeholder={current.placeholder} aria-label={current.message} onChange={(event) => setValue(event.target.value)} />}
        <div className="mt-5 flex justify-end gap-2">
          {current.kind !== "alert" && <Button type="button" variant="outline" size="sm" onClick={cancel}>{current.cancelLabel ?? "Cancel"}</Button>}
          <Button ref={ok} type="submit" size="sm" variant={danger ? "destructive" : "default"} className={danger ? "bg-destructive text-white hover:bg-destructive/90 dark:bg-destructive" : ""}
            disabled={current.kind === "prompt" && current.required && !value.trim()}>{action}</Button>
        </div>
      </form>
    </div>
  );
}

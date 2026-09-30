"use client";

import { useState } from "react";
import { Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";

export type IssuedPassword = { employeeId: string; fullName: string; oneTimePassword: string; expiresAt: string };

const expiryText = (value: string) => new Date(value).toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" });

/** A one-time password as IT sees it once: to hand over in person or by text, then dismiss. */
export function OneTimePasswordNotice({ issued, onDone }: { issued: IssuedPassword; onDone: () => void }) {
  const [copied, setCopied] = useState("");
  const message = `Dayong sign-in for ${issued.fullName}: Employee ID ${issued.employeeId}, one-time password ${issued.oneTimePassword}. It expires ${expiryText(issued.expiresAt)}. You will choose your own password when you sign in.`;
  async function copy(label: string, text: string) {
    try { await navigator.clipboard.writeText(text); setCopied(label); } catch { setCopied(""); }
  }
  return <div role="alert" className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
    <p className="flex items-center gap-2 font-semibold"><KeyRound className="size-4" />One-time password for {issued.fullName} ({issued.employeeId})</p>
    <p className="select-all break-all rounded-md border border-amber-200 bg-background px-3 py-2 font-mono text-lg tracking-wider text-foreground">{issued.oneTimePassword}</p>
    <p>Give it to {issued.fullName} in person or by text. It is shown only now, works until {expiryText(issued.expiresAt)}, and they must choose their own password when they sign in.</p>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" onClick={() => void copy("password", issued.oneTimePassword)}><Copy className="mr-1 size-3.5" />{copied === "password" ? "Copied" : "Copy password"}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => void copy("message", message)}><Copy className="mr-1 size-3.5" />{copied === "message" ? "Copied" : "Copy text message"}</Button>
      <Button type="button" size="sm" onClick={onDone}>Done, handed over</Button>
    </div>
  </div>;
}

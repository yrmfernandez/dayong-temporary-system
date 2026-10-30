"use client";

import { useEffect, useState } from "react";

import { canConfirmOrWithoutLetterFor } from "@/lib/access-control";
import { isDigitsOnlyOrNumber } from "@/lib/or-number";
import { ACTIVE_ROLE_COOKIE } from "@/lib/ui-preferences";

// Whether the open workspace is an Administrator's (lib/workspace-session.ts), asked once per workspace.
let administrator: { workspace: string; answer: Promise<boolean> } | null = null;
const workspaceCookie = () => document.cookie.split("; ").find((item) => item.startsWith(`${ACTIVE_ROLE_COOKIE}=`)) ?? "";
const isAdministrator = () => {
  const workspace = workspaceCookie();
  if (administrator?.workspace !== workspace) administrator = { workspace, answer: fetch("/api/auth/session", { cache: "no-store" })
    .then((response) => response.json() as Promise<{ success?: boolean; active?: { roleNames?: string[]; permissions?: { manageUsers?: boolean } } }>)
    .then((result) => Boolean(result.success && result.active && canConfirmOrWithoutLetterFor({ roleNames: result.active.roleNames ?? [], permissions: { manageUsers: Boolean(result.active.permissions?.manageUsers), manageAttendance: false, viewAttendanceReports: false } })))
    .catch(() => false) };
  return administrator.answer;
};

/**
 * "This OR number really has no letter" (owner, October 28, 2026): in a correction, an Administrator confirms a receipt
 * whose number has no branch letter, so the digits are accepted. Shown only to Administrators, and only while the OR
 * number typed is digits only (`always` when the form cannot tell, e.g. an uncontrolled field; then `name` posts it).
 */
export function OrNoLetterCheck({ orNumber = "", checked, onChange, always = false, name }: { orNumber?: string; checked?: boolean; onChange?: (checked: boolean) => void; always?: boolean; name?: string }) {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let live = true;
    void isAdministrator().then((value) => { if (live) setAllowed(value); });
    return () => { live = false; };
  }, []);
  if (!allowed || (!always && !isDigitsOnlyOrNumber(orNumber))) return null;
  return (
    <label className="flex items-start gap-2 text-xs text-amber-900 dark:text-amber-200">
      <input type="checkbox" className="mt-0.5" name={name} checked={checked} onChange={onChange ? (event) => onChange(event.target.checked) : undefined} />
      <span>This OR number really has no letter (Administrator). The receipt is saved without a branch letter{always ? " when it has none" : ""}.</span>
    </label>
  );
}

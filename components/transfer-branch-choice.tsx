"use client";

import { SearchSelect } from "@/components/ui/search-select";

export type BranchChoice = { branchMode: "" | "keep" | "move"; moveTo: string };
export const noBranchChoice: BranchChoice = { branchMode: "", moveTo: "" };

/** The accounts' branches the new MAS is not assigned to (case-insensitive). */
export const branchesOutside = (accountBranches: string[], targetBranches: string[]) =>
  [...new Set(accountBranches.filter((branch) => !targetBranches.some((other) => other.trim().toLowerCase() === branch.trim().toLowerCase())))];

/** Complete when nothing is outside, or a mode is chosen (and a destination for move). */
export const branchChoiceReady = (outside: string[], choice: BranchChoice) =>
  !outside.length || choice.branchMode === "keep" || (choice.branchMode === "move" && Boolean(choice.moveTo));

/**
 * Transfer to a MAS from another branch (owner, October 14, 2026; lib/member-transfer.ts): for accounts in branches the
 * new MAS is not assigned to, keep their branch (the MAS is assigned to it) or move them to one of the MAS's branches.
 */
export function TransferBranchChoice({ name, outside, count, targetBranches, value, onChange }: {
  name: string; outside: string[]; count: number; targetBranches: string[]; value: BranchChoice; onChange: (value: BranchChoice) => void;
}) {
  if (!outside.length) return null;
  const option = (mode: "keep" | "move", title: string, detail: string) => (
    <label className={`flex cursor-pointer gap-2 rounded-md border p-2 ${value.branchMode === mode ? "border-primary bg-primary/5" : "bg-background"}`}>
      <input type="radio" name={`branch-mode-${name}`} className="mt-1" checked={value.branchMode === mode} onChange={() => onChange({ branchMode: mode, moveTo: mode === "move" ? value.moveTo || targetBranches[0] || "" : "" })} />
      <span><span className="font-medium">{title}</span><span className="block text-xs text-muted-foreground">{detail}</span></span>
    </label>
  );
  return (
    <fieldset className="space-y-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
      <legend className="px-1 font-medium">{name} is from another branch *</legend>
      <p className="text-xs text-muted-foreground">{count} account{count === 1 ? " is" : "s are"} in {outside.join(", ")}, where {name} is not assigned. Collections need the MAS assigned to the account&apos;s branch, so choose:</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {option("keep", `Keep in ${outside.join(", ")}`, `${name} is assigned to ${outside.length === 1 ? "that branch" : "those branches"} (Employees). The accounts, their reports and history stay where they are.`)}
        {option("move", `Move to ${name}'s branch`, targetBranches.length ? "The accounts change branch; future collections and reports follow. Past entries stay under the old branch." : `${name} has no branch assigned yet.`)}
      </div>
      {value.branchMode === "move" && targetBranches.length > 0 && (
        <label className="block max-w-xs text-xs">Move to branch *
          <SearchSelect aria-label="Move to branch" className="mt-1 h-9" value={value.moveTo} onValueChange={(moveTo) => onChange({ ...value, moveTo })} options={targetBranches.map((branch, index) => ({ value: branch, label: branch, description: index === 0 ? "primary" : undefined }))} />
        </label>
      )}
    </fieldset>
  );
}

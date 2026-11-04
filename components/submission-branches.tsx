"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Submitted by MAS, on Collections and New Sales (owner, November 4, 2026): a clerk of several branches, or an
 * administrator, chooses which branch's batches to list. The choice lasts while reviewing batches one after another; a
 * branch whose batches are all done goes back to All branches. With one branch there is nothing to choose.
 */
export function useSubmissionBranches<T extends { branch: string }>(submissions: T[]) {
  const [chosen, setChosen] = useState("");
  const branches = [...new Set(submissions.map((submission) => submission.branch))].sort((a, b) => a.localeCompare(b));
  const branch = branches.includes(chosen) ? chosen : "";
  const count = (name: string) => submissions.filter((submission) => submission.branch === name).length;
  const picker = branches.length > 1 ? <div role="radiogroup" aria-label="Branch" className="flex gap-2 overflow-x-auto pb-1">
    {[["", `All branches (${submissions.length})`], ...branches.map((name) => [name, `${name} (${count(name)})`])].map(([value, label]) => (
      <Button key={value || "all"} type="button" size="sm" role="radio" aria-checked={branch === value} variant={branch === value ? "default" : "outline"} className="shrink-0" onClick={() => setChosen(value)}>{label}</Button>
    ))}
  </div> : null;
  return { shown: branch ? submissions.filter((submission) => submission.branch === branch) : submissions, picker };
}

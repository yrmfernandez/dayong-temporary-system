/**
 * Read-only (October 10, 2026). What the Exceptions page lists, summarized so the owner can decide what to fix:
 * per list, how many items (old data vs entered in this system) and the kinds of problem, with numbers blanked so
 * alike problems group together (e.g. "OR number # is also on collection #"). No member names are printed; every
 * item (record ID, list, problem, date, old data or not) goes to legacy-data/exceptions.csv.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/exceptions-summary.mts                 staging
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/exceptions-summary.mts production
 *   ... scripts/exceptions-summary.mts --legacy     also the checks the page runs only with "Include old data"
 */
import fs from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const includeLegacy = process.argv.includes("--legacy");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "unknown";
const { runAsSystem } = await import("../lib/encoder-context");
const { findExceptions } = await import("../lib/exceptions");

await runAsSystem(async () => {
  const result = await findExceptions({ includeLegacy }) as unknown as { categories: Array<{ category: string; label: string; total: number; items: Array<{ recordId: string; problem: string; date: string; legacy: boolean }> }>; allItems?: unknown };
  console.log(`Supabase project: ${project}${includeLegacy ? " · old data included" : ""}\n`);
  const rows: string[][] = [["list", "record id", "old data", "date", "problem"]];
  const cell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  for (const category of result.categories) {
    if (!category.total) { console.log(`${category.label}: 0`); continue; }
    const legacy = category.items.filter((item) => item.legacy).length;
    const shown = category.items.length;
    console.log(`${category.label}: ${category.total}${shown < category.total ? ` (first ${shown} summarized)` : ""} · old data ${legacy} · this system ${shown - legacy}`);
    // Problems with numbers, dates, amounts and quoted text blanked, so alike ones count together.
    const pattern = (problem: string) => problem.replace(/"[^"]*"/g, '"…"').replace(/₱[\d,]+(\.\d+)?/g, "₱#").replace(/\b[A-Z]{2,5}-[\w-]+/g, "#ID").replace(/\d[\d,./:-]*/g, "#").replace(/\s+/g, " ").trim();
    const counts = new Map<string, number>();
    for (const item of category.items) counts.set(pattern(item.problem), (counts.get(pattern(item.problem)) ?? 0) + 1);
    for (const [text, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`   ${String(count).padStart(5)} × ${text.slice(0, 150)}`);
    if (counts.size > 8) console.log(`         … ${counts.size - 8} other kinds`);
    for (const item of category.items) rows.push([category.label, item.recordId, item.legacy ? "yes" : "no", item.date, item.problem]);
  }
  fs.mkdirSync("legacy-data", { recursive: true });
  fs.writeFileSync("legacy-data/exceptions.csv", `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`);
  console.log(`\nEvery item listed: legacy-data/exceptions.csv`);
});
process.exit(0);

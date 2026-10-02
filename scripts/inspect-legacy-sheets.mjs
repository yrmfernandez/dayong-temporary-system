// Read-only profile of the old (pre-system) territory spreadsheets, used to plan the legacy migration.
// It never prints member names, addresses, contact numbers, birthdates, or beneficiaries: those columns are
// reported only as format shapes (e.g. "99/99/9999") and counts. Only non-personal columns (branch, program,
// agent, status, ...) print their distinct values.
//
// Usage: node scripts/inspect-legacy-sheets.mjs [file.xlsx | file.csv | folder | Google Sheets URL ...]
// With no arguments it reads every .xlsx/.csv in legacy-data/ (git-ignored). Google Sheets sources must be shared
// (Viewer) with GOOGLE_SERVICE_ACCOUNT_EMAIL. The current database is always read for the [NO MATCH] checks.
import nextEnv from "@next/env";
import { google } from "googleapis";
import { loadLegacySources } from "./legacy-sources.mjs";

nextEnv.loadEnvConfig(process.cwd());
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"] });
const sheets = google.sheets({ version: "v4", auth });
const options = { timeout: 30000, retry: false };

// Columns whose distinct values are safe to print (codes, staff, categories), matched on the normalized header.
const CATEGORICAL = [/^branch$/, /^marketing agent$/, /^dayong program$/, /^type of transaction$/, /^with regi?s?t?ration fee/, /^registration amount$/, /^civil status$/, /^relationship$/, /^status$/, /^reactivation$/, /^transferred$/, /^if suspended$/, /original mas/, /^month of$/, /^nop$/, /^amount collected$/, /^age$/];
const display = (value) => (value instanceof Date ? value.toISOString().slice(0, 10) : value);
const norm = (value) => String(display(value) ?? "").trim().toUpperCase().replace(/\s+/g, " ");
const headerKey = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
const isCategorical = (header) => CATEGORICAL.some((pattern) => pattern.test(headerKey(header)));
// Letters collapse to one "A" per word so names reveal nothing; digits keep their count so date formats show.
const shape = (value) => value instanceof Date ? "<date cell>" : typeof value === "number" ? (Number.isInteger(value) ? "<whole number>" : "<decimal number>") : String(value).trim().replace(/\p{L}+/gu, "A").replace(/\d/g, "9");
const columnLetter = (index) => { let s = ""; for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function top(map, limit) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

// Name keys from loosest to strictest evidence that two spellings are the same person.
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV"]);
const tokens = (name) => norm(name).replace(/[^A-ZÑ ]+/g, " ").split(" ").filter(Boolean);
const exactKey = (name) => tokens(name).join(" ");
const orderFreeKey = (name) => [...tokens(name)].sort().join(" ");
const coreTokens = (name) => tokens(name).filter((t) => t.length > 1 && !SUFFIXES.has(t));
const coreKey = (name) => [...coreTokens(name)].sort().join(" ");

function nameReport(names) {
  const present = names.filter((n) => norm(n));
  const distinct = (fn) => new Set(present.map(fn)).size;
  // Names whose core tokens are a strict subset of another name's (e.g. no middle name vs. with middle name).
  const cores = [...new Set(present.map(coreKey))].map((k) => k.split(" ").filter(Boolean));
  let subsetOfAnother = 0;
  const bySet = cores.map((c) => new Set(c));
  for (let i = 0; i < cores.length; i++) {
    if (cores[i].length < 2) continue;
    if (bySet.some((other, j) => j !== i && other.size > cores[i].length && cores[i].every((t) => other.has(t)))) subsetOfAnother++;
  }
  return { rowsWithName: present.length, distinctAsWritten: new Set(present.map(norm)).size, distinctIgnoringPunctuation: distinct(exactKey), distinctIgnoringOrder: distinct(orderFreeKey), distinctIgnoringInitialsAndSuffixes: distinct(coreKey), namesThatAreSubsetOfAnother: subsetOfAnother, singleWordNames: present.filter((n) => tokens(n).length < 2).length };
}

async function readDatabaseLookups() {
  const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: process.env.GOOGLE_SHEET_ID, ranges: ["Programs!A:C", "Branches!A:B", "Employees!A:B"] }, options);
  const [programs, branches, employees] = response.data.valueRanges.map((r) => (r.values ?? []).slice(1));
  return {
    program: new Set(programs.flatMap((r) => [norm(r[0]), norm(r[1]), norm(r[2])]).filter(Boolean)),
    branch: new Set(branches.flatMap((r) => [norm(r[0]), norm(r[1])]).filter(Boolean)),
    employee: new Set(employees.flatMap((r) => [norm(r[0]), norm(r[1]), coreKey(r[1])]).filter(Boolean)),
  };
}

const lookups = await readDatabaseLookups();
const lookupFor = (header) => { const h = headerKey(header); return h === "branch" ? "branch" : h === "dayong program" ? "program" : (h === "marketing agent" || h.includes("original mas")) ? "employee" : null; };
const memberNamesByKind = { collections: [], sales: [] };

for (const source of await loadLegacySources(process.argv.slice(2), () => sheets)) {
  console.log(`\n=== Source: ${source.title} ===`);
  for (const tab of source.tabs) {
    const [headers = [], ...rows] = tab.rows;
    const dataRows = rows.filter((r) => r.some((c) => String(display(c) ?? "").trim()));
    const keys = headers.map(headerKey);
    const kind = keys.includes("nop") || keys.includes("month of") ? "collections" : keys.includes("type of transaction") || keys.includes("application no") ? "sales" : "other";
    console.log(`\n--- Tab "${tab.title}" · detected: ${kind} · header on row ${tab.firstRow} · ${dataRows.length} data rows · ${headers.length} columns`);
    if (kind === "other") { console.log(`headers: ${JSON.stringify(headers)}`); continue; }

    headers.forEach((header, index) => {
      const filled = dataRows.map((r) => r[index]).filter((v) => String(display(v) ?? "").trim());
      const label = `${columnLetter(index)} "${header}"`;
      if (!filled.length) { console.log(`${label}: empty`); return; }
      const fill = `${filled.length}/${dataRows.length} filled`;
      if (isCategorical(header)) {
        const counts = new Map();
        for (const v of filled) counts.set(norm(v), (counts.get(norm(v)) ?? 0) + 1);
        const kindOfLookup = lookupFor(header);
        const listed = top(counts, 40).map(([v, n]) => `${v} ×${n}${kindOfLookup && !(lookups[kindOfLookup].has(v) || lookups[kindOfLookup].has(coreKey(v))) ? " [NO MATCH]" : ""}`);
        console.log(`${label}: ${fill}, ${counts.size} distinct${counts.size > 40 ? " (top 40)" : ""}\n    ${listed.join(" | ")}`);
      } else {
        const shapes = new Map();
        for (const v of filled) shapes.set(shape(v), (shapes.get(shape(v)) ?? 0) + 1);
        console.log(`${label}: ${fill}, formats: ${top(shapes, 6).map(([s, n]) => `"${s}" ×${n}`).join(", ")}`);
      }
    });

    const memberColumn = keys.indexOf("ph/member");
    if (memberColumn >= 0) {
      const names = dataRows.map((r) => r[memberColumn]);
      memberNamesByKind[kind].push(...names);
      console.log(`PH/MEMBER name analysis: ${JSON.stringify(nameReport(names))}`);
    }
  }
}

// How many collection payers can be tied back to a New Sales record, at each matching strictness.
const salesKeys = { exact: new Set(memberNamesByKind.sales.map(exactKey)), orderFree: new Set(memberNamesByKind.sales.map(orderFreeKey)), core: new Set(memberNamesByKind.sales.map(coreKey)) };
const salesCores = [...salesKeys.core].map((k) => new Set(k.split(" ")));
const payers = [...new Set(memberNamesByKind.collections.filter((n) => norm(n)).map(exactKey))];
const tally = { distinctPayers: payers.length, exact: 0, ignoringOrder: 0, ignoringInitials: 0, middleNameDiffersOnly: 0, noMatch: 0 };
for (const payer of payers) {
  if (salesKeys.exact.has(payer)) tally.exact++;
  else if (salesKeys.orderFree.has(orderFreeKey(payer))) tally.ignoringOrder++;
  else if (salesKeys.core.has(coreKey(payer))) tally.ignoringInitials++;
  else { const core = coreTokens(payer); if (core.length >= 2 && salesCores.some((s) => core.every((t) => s.has(t)) || [...s].every((t) => core.includes(t)))) tally.middleNameDiffersOnly++; else tally.noMatch++; }
}
console.log(`\n=== Collections payers vs New Sales members (all spreadsheets) ===\n${JSON.stringify(tally, null, 2)}`);

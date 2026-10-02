// Builds the program list for the legacy migration from the old spreadsheets' DAYONG PROGRAM labels.
//
//   node scripts/legacy-programs.mjs            propose: group spelling variants, estimate monthly rates, and write
//                                               config/legacy-programs.json (kept if it already exists; --refresh rebuilds it)
//   node scripts/legacy-programs.mjs --apply    add every program in that file that is not yet in the Programs sheet
//
// Review config/legacy-programs.json before --apply: "aliases" maps each old label to a program code, and each program's
// base_pay is a draft (the most common amount paid per month). Admins finalize rates, totals, and incentives in the app.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { google } from "googleapis";
import { loadLegacySources } from "./legacy-sources.mjs";

nextEnv.loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const refresh = args.includes("--refresh");
const MAP_FILE = "config/legacy-programs.json";
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const DB = process.env.GOOGLE_SHEET_ID;
const options = { timeout: 60000, retry: false };

const str = (v) => String(v ?? "").trim();
const headerKey = (v) => str(v).toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
const label = (v) => str(v).toUpperCase().replace(/\s+/g, " ");

// Likely typos of an existing prefix, merged by default (edit the aliases in the file to undo).
const TYPO_PREFIXES = { DBP: "DPB", DPD: "DPB", DDPB: "DPB", DPP: "DFPP", C: "DC" };

/** One spelling per program: "DSP - 290", "DSP 290", "DSP-290" -> "DSP-290"; "D-300(NEW)" -> "D-300 (NEW)". */
export function canonicalProgram(raw) {
  let s = label(raw)
    .replace(/=/g, "-").replace(/(\d),(\d{3})\b/g, "$1$2")
    .replace(/\bBRAKETING\b/g, "BRACKETING").replace(/NEWBRACKETING/g, "NEW BRACKETING")
    .replace(/\(?\s*\b([56])\s*(?:Y|YR|YRS|YEARS?)\b\s*\)?/g, " ($1Y)")
    .replace(/\s*-+\s*/g, "-").replace(/\(\s*/g, " (").replace(/\s*\)/g, ")").replace(/\s+/g, " ").trim();
  s = s.replace(/^(\d+)\b/, "D-$1"); // "280" -> "D-280"
  s = s.replace(/^([A-Z]+) (\d)/, "$1-$2"); // "D 185" -> "D-185"
  s = s.replace(/^([A-Z]+-\d+)(HG|FG)\b/, "$1 $2"); // "D-250FG" -> "D-250 FG"
  s = s.replace(/^([A-Z]+-\d+) (BRACKETING|NEW BRACKETING|NEW)$/, "$1 ($2)"); // "D-300 BRACKETING" -> "D-300 (BRACKETING)"
  const words = s.split(" ");
  if (words.length === 2 && words[0] === words[1]) s = words[0]; // "DPB-490 DPB-490"
  const prefix = s.match(/^([A-Z]+)-/)?.[1];
  if (prefix && TYPO_PREFIXES[prefix]) s = s.replace(/^[A-Z]+-/, `${TYPO_PREFIXES[prefix]}-`);
  return s;
}

const mode = (values) => { const counts = new Map(); for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1); return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]; };

async function propose() {
  const found = new Map(); // canonical -> { variants: Map, payments, sales, monthly: [] }
  for (const source of await loadLegacySources([], () => sheets)) {
    for (const tab of source.tabs) {
      const [headers = [], ...rows] = tab.rows;
      const keys = headers.map(headerKey);
      const kind = keys.includes("nop") || keys.includes("month of") ? "collections" : keys.includes("type of transaction") || keys.includes("application no") ? "sales" : null;
      const programColumn = keys.indexOf("dayong program");
      if (!kind || programColumn < 0) continue;
      const amountColumn = keys.indexOf("amount collected"), nopColumn = keys.indexOf("nop");
      for (const row of rows) {
        const raw = label(row[programColumn]);
        if (!raw) continue;
        const code = canonicalProgram(raw);
        if (!found.has(code)) found.set(code, { variants: new Map(), payments: 0, sales: 0, monthly: [] });
        const entry = found.get(code);
        entry.variants.set(raw, (entry.variants.get(raw) ?? 0) + 1);
        if (kind === "sales") { entry.sales++; continue; }
        entry.payments++;
        // A one-NOP payment is one month's rate.
        const nop = str(row[nopColumn]), amount = Number(str(row[amountColumn]).replace(/[^0-9.]/g, ""));
        if (/^\d+$/.test(nop) && amount > 0) entry.monthly.push(amount);
      }
    }
  }
  const programs = [...found].sort((a, b) => (b[1].payments + b[1].sales) - (a[1].payments + a[1].sales)).map(([code, e]) => {
    const fromLabel = Number(code.match(/-(\d+)/)?.[1]) || 0;
    const fromPayments = mode(e.monthly) ?? 0;
    // A handful of payments is too few to override the rate in the program's name.
    return { code, base_pay: (e.monthly.length >= 5 && fromPayments) || fromLabel || fromPayments, rate_in_label: fromLabel, most_common_monthly_payment: fromPayments, payments: e.payments, sales: e.sales, variants: Object.fromEntries(e.variants) };
  });
  const aliases = Object.fromEntries(programs.flatMap((p) => Object.keys(p.variants).map((v) => [v, p.code])));
  return { note: "Draft. 'aliases' maps each old DAYONG PROGRAM label to a program code; edit it to merge or split programs. base_pay is the most common monthly payment (or the number in the label). Admins finalize programs in the app.", programs, aliases };
}

let map;
if (existsSync(MAP_FILE) && !refresh) {
  map = JSON.parse(readFileSync(MAP_FILE, "utf8"));
  console.log(`Using ${MAP_FILE} (run with --refresh to rebuild it from the old data).`);
} else {
  map = await propose();
  writeFileSync(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`Wrote ${MAP_FILE}.`);
}

const existing = ((await sheets.spreadsheets.values.get({ spreadsheetId: DB, range: "Programs!A:C" }, options)).data.values ?? []).slice(1);
const known = new Set(existing.flatMap((r) => [label(r[1]), label(r[2])]));
const usedCodes = new Set(Object.values(map.aliases));
const missing = map.programs.filter((p) => usedCodes.has(p.code) && !known.has(label(p.code)));

console.log(`\n${map.programs.length} program(s) from ${Object.keys(map.aliases).length} old label(s). Already in Programs: ${map.programs.length - missing.length}. To add: ${missing.length}.\n`);
console.log("code".padEnd(26), "base_pay".padStart(8), "label".padStart(6), "paid/mo".padStart(8), "payments".padStart(9), "sales".padStart(6), " variants merged");
for (const p of map.programs) {
  const merged = Object.keys(p.variants).filter((v) => v !== p.code);
  console.log(p.code.padEnd(26), String(p.base_pay).padStart(8), String(p.rate_in_label).padStart(6), String(p.most_common_monthly_payment).padStart(8), String(p.payments).padStart(9), String(p.sales).padStart(6), merged.length ? ` ← ${merged.join(" | ")}` : "", known.has(label(p.code)) ? " (exists)" : "");
}

if (!apply) { console.log(`\nReview ${MAP_FILE}, then run with --apply to add the ${missing.length} missing program(s).`); process.exit(0); }

// Program IDs continue the app's DP-#### sequence.
let next = Math.max(0, ...existing.map((r) => Number(str(r[0]).match(/^DP-(\d+)$/)?.[1]) || 0)) + 1;
const importedAt = new Date().toISOString();
const rows = missing.map((p) => [
  `DP-${String(next++).padStart(4, "0")}`, p.code, p.code, p.base_pay, "active",
  `Imported from the old database (${p.payments} payments, ${p.sales} sales). Draft: review the monthly rate, pay-balance total, registration, and incentives.`,
  "", "", "Legacy import", importedAt, "No", 0, 0, "No", "", "", "", "",
]);
if (rows.length) await sheets.spreadsheets.values.append({ spreadsheetId: DB, range: "Programs!A:R", valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: rows } }, options);
console.log(`\nAdded ${rows.length} program(s) to the Programs sheet.`);

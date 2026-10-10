// Migrates the old database workbook (per-territory "…-NS" New Sales and "…-COLL" Collections tabs) into Members,
// Member programs, Sales, Beneficiaries, and Collections.
//
//   node scripts/migrate-legacy-members.mjs                              dry run of every .xlsx/.csv in legacy-data/ (writes nothing)
//   node scripts/migrate-legacy-members.mjs --apply                      write; refuses if any account fails review
//   node scripts/migrate-legacy-members.mjs --apply --skip-invalid       write only the accounts that pass review
//   add --fix-nop-typos to renumber NOPs in OR-date order where that alone (changing at most 2 payments) passes review
//   node scripts/migrate-legacy-members.mjs --fix-nop-typos --export-pending   copy every row the database does not have
//                                       into new "Legacy Pending NS" / "Legacy Pending COLL" tabs in the database
//   node scripts/migrate-legacy-members.mjs --pending --fix-nop-typos [--apply --skip-invalid]   migrate from those tabs
//   after staff fix them (rows keep their original source, tab, row, and assigned member, so IDs and members stay stable)
//   add --repair to fix failing accounts by rule (company decision 2026-10-04), each change listed in "Legacy Repairs":
//     - AMOUNT COLLECTED unreadable: the program's monthly rate x the months covered (or the usual monthly amount paid
//       for that program when it has no rate);  OR DATE unreadable: the DATE REMITTED (a date before 2000 or after
//       today counts as unreadable, e.g. 3/7/0226 for 3/7/2026; owner, October 9, 2026), on New Sales and Collections;
//     - the same OR number twice on one account: one kept;
//     - missing NOPs, and receipts claiming the same NOP or month: every payment renumbered consecutively in OR-date
//       order (DATE REMITTED, then the written NOP, break ties), from NOP 2 after a New Sale or from the account's
//       first NOP (NOP 1 when the DOI came from the first OR date); a payment covers exactly the months its amount pays
//       at the program's monthly rate. An amount that is not a whole number of monthly payments is not imported: the
//       account is listed under "Not imported: payment is not a whole number of monthly payments" for review;
//     - no usable DOI: the account's first OR date is the DOI.
//     Only accounts that fail review as recorded are repaired. With --pending --apply, imported rows are removed from
//     the Legacy Pending tabs.
//   node scripts/migrate-legacy-members.mjs --pending --drop-existing [--apply]   remove the pending rows of accounts
//     already in the database (rows left out on purpose as duplicates of what was imported); a dry run lists the count.
// Sources can also be named explicitly: .xlsx/.csv files, folders, or Google Sheets URLs shared with the service account.
// Run scripts/legacy-programs.mjs first: old DAYONG PROGRAM labels are mapped through config/legacy-programs.json.
//
// Privacy: the console and the report file identify problems by workbook, tab, and row number only. Member names,
// addresses, contacts, and birthdates are never printed.
//
// How old rows become records:
// - Each New Sales row is one sale. Rows for the same person (same name ignoring order, middle initials, and suffixes,
//   or a name missing only the middle name) become one member when their birthdates agree or one is blank.
//   One enrollment per member and program; DOI = the sale's OR DATE.
// - Each Collections row is matched by name to a New Sales enrollment of the same program, preferring the same
//   territory (tab) and branch. Payers with no New Sale (members older than the New Sales log) become members with a
//   name only, one per name within a territory; their DOI month is worked back from NOP (NOP 1 = DOI month), day 1.
// - A payment's months come from its NOP and the DOI (MONTH OF rarely has a year); MONTH OF is only checked against it.
//   A NOP 1 collection on an account with a New Sale repeats that sale and is skipped.
// - Old payments were already remitted: imported as remittance status "Remitted". STATUS Collector/DTO sets who
//   collected the payment; Active/Inactive is compared with the status the system computes.
// - Every account is checked with the system's own rules (lib/account-rules.ts) before anything is written.
// IDs are derived from the source ("-LEG-"), so a re-run skips what was already imported.
//
// Since October 5, 2026 the application data is in PostgreSQL: run this with tsx so it can use the app's database layer
//   npx tsx --tsconfig tsconfig.json scripts/migrate-legacy-members.mjs --pending --repair [--apply --skip-invalid]
// Members, enrollments, sales, beneficiaries and collections are read from and written to the database named by
// DATABASE_URL (staging in .env.local; production when set in the shell). The Legacy Pending tabs and Legacy Repairs
// stay in the Google Sheet. Never run --apply against staging: it would delete pending rows from the shared sheet.
// A receipt or application number already in use is imported flagged legacy_duplicate, like the October copy.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import nextEnv from "@next/env";
import { google } from "googleapis";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";
import { loadLegacySources } from "./legacy-sources.mjs";

nextEnv.loadEnvConfig(process.cwd());
// This script reads whole tables (about 60,000 collections) several at once; Supabase's transaction pooler (port 6543)
// drops such long transfers ("CONNECTION_CLOSED", October 10, 2026), so it uses the session connection (port 5432).
if (process.env.DIRECT_DATABASE_URL) process.env.DATABASE_URL = process.env.DIRECT_DATABASE_URL;
// Parsing the workbook keeps the CPU busy long enough for an idle connection to be closed under a query (lib/db.ts).
process.env.DAYONG_DB_IDLE_TIMEOUT = "0";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const skipInvalid = args.includes("--skip-invalid");
const fixNopTypos = args.includes("--fix-nop-typos");
const exportPending = args.includes("--export-pending");
const fromPending = args.includes("--pending");
const repair = args.includes("--repair");
const dropExisting = args.includes("--drop-existing");
const PENDING_PREFIX = "Legacy Pending";
const sourceArgs = args.filter((a) => !a.startsWith("--"));
// --source-title=NAME reads a newer download of the same workbook as if it were the file imported before (October 8,
// 2026: the October 1 import was "Data-Base-Old"). Record IDs come from title, tab and row, so rows already imported
// keep their IDs and are skipped, and only rows added since are imported. The Google Form tabs only grow at the bottom
// (checked: 62,881 of 62,890 rows still match their record by timestamp).
const sourceTitle = args.find((a) => a.startsWith("--source-title="))?.slice("--source-title=".length) ?? "";

const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const DB = process.env.GOOGLE_SHEET_ID;
const options = { timeout: 60000, retry: false };

const PROGRAM_FILE = "config/legacy-programs.json";
if (!existsSync(PROGRAM_FILE)) { console.error(`${PROGRAM_FILE} is missing. Run node scripts/legacy-programs.mjs (and --apply) first.`); process.exit(1); }
// Optional overrides for old values the database does not recognize: { "branches": { "OLD": "Branch name" }, "agents": { "OLD NAME": "EMPLOYEE-ID" } }.
// "leaveOut": { "Data-Base-Old|M1-COLL|8871": "reason" } skips rows the owner says do not belong to the account they
// would join (e.g. a receipt of another, forfeited enrollment); they stay in the pending tabs, listed with the reason.
// "members": { "MEM-LEG-…": "MEM-LEG-…" } sends pending rows assigned to the first member to the second (an existing
// member the owner says is the same person). "programs" / "amounts": { "<row ref>": { "program" | "amount": …, "note" } }
// correct one row's DAYONG PROGRAM or AMOUNT COLLECTED (owner), logged in Legacy Repairs.
const MAP_FILE = "config/legacy-migration-map.json";
const overrides = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, "utf8")) : {};
const override = (group, value) => Object.entries(overrides[group] ?? {}).find(([k]) => norm(k) === norm(value))?.[1];

/* ---------- text, names, dates ---------- */
// Excel date cells arrive as Dates holding the wall-clock time in UTC fields; Google Sheets sends serial numbers.
const toSerial = (v) => (v instanceof Date ? (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000 : v);
const str = (v) => String(v instanceof Date ? v.toISOString().slice(0, 10) : v ?? "").trim();
const norm = (v) => str(v).toUpperCase().replace(/\s+/g, " ");
const headerKey = (v) => str(v).toLowerCase().replace(/[^a-z0-9/ ]+/g, " ").replace(/\s+/g, " ").trim();
const SUFFIXES = new Set(["JR", "SR", "II", "III", "IV", "V"]);
const tokens = (name) => norm(name).replace(/[^A-ZÑ ]+/g, " ").split(" ").filter(Boolean);
const exactKey = (name) => tokens(name).join(" ");
const orderFreeKey = (name) => [...tokens(name)].sort().join(" ");
const coreTokens = (name) => tokens(name).filter((t) => t.length > 1 && !SUFFIXES.has(t));
const coreKey = (name) => [...coreTokens(name)].sort().join(" ");
const subsetMatch = (a, b) => { const x = coreTokens(a), y = new Set(coreTokens(b)); return x.length >= 2 && x.length < y.size && x.every((t) => y.has(t)); };
const sameish = (a, b) => coreKey(a) === coreKey(b) || subsetMatch(a, b) || subsetMatch(b, a);
// Name tiers, strictest first: as written, any word order, ignoring initials/suffixes, missing a middle name.
const NAME_RULES = [(a, b) => exactKey(a) === exactKey(b), (a, b) => orderFreeKey(a) === orderFreeKey(b), (a, b) => coreKey(a) === coreKey(b), sameish];
// New Sales members indexed by each core name token, so matching only compares names that share a word.
const nameIndex = new Map();
const indexName = (name, item) => { for (const t of new Set(coreTokens(name))) { if (!nameIndex.has(t)) nameIndex.set(t, []); nameIndex.get(t).push(item); } };
const nameCandidates = (name) => [...new Set(coreTokens(name).flatMap((t) => nameIndex.get(t) ?? []))];

const PARTICLES = new Set(["DE", "DEL", "DELA", "DELOS", "DELAS", "LA", "LOS", "SAN", "STA", "STO", "SANTA", "SANTO", "VDA", "DI"]);
const isInitial = (t) => /^[A-ZÑ]\.?$/.test(t);
/** Splits an old full name into Members' surname/first/middle/extension. `guessed` marks names without a comma. */
function parseName(raw) {
  let text = norm(raw).replace(/\s*,\s*/g, ", ").replace(/(, )+/g, ", ");
  let nameExtension = "";
  text = text.replace(/,?\s*\b(JR|SR|II|III|IV)\b\.?/g, (m, s) => { nameExtension = s === "JR" || s === "SR" ? `${s[0]}${s.slice(1).toLowerCase()}.` : s; return ""; }).trim().replace(/,$/, "");
  const finish = (surname, rest, guessed) => {
    const parts = rest.split(" ").filter(Boolean);
    const middleName = parts.length > 1 && isInitial(parts.at(-1)) ? parts.pop().replace(/\.?$/, ".") : "";
    return { surname: surname.trim(), firstName: parts.join(" "), middleName, nameExtension, guessed };
  };
  // "SURNAME, FIRST, MIDDLE" (a second comma) puts the middle name after it.
  if (text.includes(",")) {
    const [surname, first, ...more] = text.split(",").map((s) => s.trim());
    if (more.length) return { surname, firstName: first, middleName: more.join(" "), nameExtension, guessed: false };
    return finish(surname, first ?? "", false);
  }
  const parts = text.split(" ").filter(Boolean);
  if (parts.length < 2) return { surname: parts[0] ?? "", firstName: "", middleName: "", nameExtension, guessed: true };
  // "JUAN P. DELA CRUZ": everything after the middle initial is the surname; otherwise the last word plus particles.
  const initial = parts.findIndex((t, i) => i > 0 && i < parts.length - 1 && isInitial(t));
  if (initial > 0) return { surname: parts.slice(initial + 1).join(" "), firstName: parts.slice(0, initial).join(" "), middleName: parts[initial].replace(/\.?$/, "."), nameExtension, guessed: true };
  let start = parts.length - 1;
  while (start > 1 && PARTICLES.has(parts[start - 1])) start--;
  return { surname: parts.slice(start).join(" "), firstName: parts.slice(0, start).join(" "), middleName: "", nameExtension, guessed: true };
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const pad = (n) => String(n).padStart(2, "0");
const iso = (y, m, d) => { const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : ""; };
const fullYear = (y) => (y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y);
const serialDate = (n) => new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
const monthNumber = (word) => MONTHS.indexOf(String(word).toUpperCase().slice(0, 3)) + 1;
/** Old cells hold real dates (serial numbers) or typed text. Returns { date, flag } where flag notes a guess. */
function parseDate(value) {
  value = toSerial(value);
  if (typeof value === "number" && value > 0) return { date: serialDate(value) };
  const s = norm(value).replace(/\.$/, "");
  if (!s) return { date: "" };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return { date: iso(+m[1], +m[2], +m[3]) };
  if ((m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/))) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3]);
    if (a > 12) return { date: iso(y, b, a), flag: "day/month order" };
    return { date: iso(y, a, b) };
  }
  if ((m = s.match(/^([A-Z]+)\.? (\d{1,2}),? (\d{2,4})$/)) && monthNumber(m[1])) return { date: iso(fullYear(+m[3]), monthNumber(m[1]), +m[2]) };
  if ((m = s.match(/^(\d{1,2})[ -]([A-Z]+)\.?[ -](\d{2,4})$/)) && monthNumber(m[2])) return { date: iso(fullYear(+m[3]), monthNumber(m[2]), +m[1]) };
  return { date: "" };
}
function parseTimestamp(value) {
  value = toSerial(value);
  if (typeof value === "number" && value > 0) {
    // Sheets serials are local (Manila) wall-clock time.
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000) - 8 * 3600000).toISOString();
  }
  const { date } = parseDate(str(value).split(" ")[0]);
  return date ? `${date}T00:00:00.000Z` : "";
}
/**
 * MONTH OF as months of the year in paid order: "JANUARY, DECEMBER" -> [12, 1]; "JANUARY, NOVEMBER, DECEMBER" -> [11, 12, 1].
 * Years are ignored (the year comes from NOP and DOI). Returns null when unreadable or not consecutive.
 */
function parseMonthNames(value) {
  value = toSerial(value);
  if (typeof value === "number" && value > 0) return [Number(serialDate(value).slice(5, 7))];
  const set = new Set([...norm(value).matchAll(/[A-Z]{3,}/g)].map((m) => monthNumber(m[0])).filter((n) => n > 0));
  if (!set.size) return null;
  if (set.size === 12) return [...set].sort((a, b) => a - b);
  const prev = (m) => ((m + 10) % 12) + 1;
  const starts = [...set].filter((m) => !set.has(prev(m)));
  if (starts.length !== 1) return null;
  return Array.from({ length: set.size }, (_, i) => ((starts[0] - 1 + i) % 12) + 1);
}
function parseNop(value) {
  value = toSerial(value);
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? { from: value, to: value } : null;
  const nums = (norm(value).match(/\d+/g) ?? []).map(Number);
  if (!nums.length || (nums.length > 2 && !/,/.test(str(value)))) return null;
  const from = Math.min(...nums), to = Math.max(...nums);
  return from > 0 ? { from, to } : null;
}
const parseAmount = (v) => { if (typeof v === "number") return v; const n = Number(str(v).replace(/[^0-9.-]/g, "")); return str(v) && Number.isFinite(n) ? n : NaN; };
const numberOrBlank = (v) => { const n = parseAmount(v); return Number.isFinite(n) && n > 0 ? n : ""; };
// "N/A", "-", "--", "A/" and similar placeholders hold no reference number.
const reference = (v) => (/\d/.test(str(v)) ? str(v) : "");
const yesNo = (v) => (/^(Y|YES|TRUE|1|✓|✔)$/i.test(str(v)) ? "Yes" : "No");
const titleCase = (v) => str(v).toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
const hashId = (prefix, ...parts) => `${prefix}-LEG-${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10).toUpperCase()}`;
const mode = (values) => { const counts = new Map(); for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1); const sorted = [...counts].sort((a, b) => b[1] - a[1]); return sorted[0] ? { value: sorted[0][0], share: sorted[0][1] / values.length } : null; };

/* ---------- issue log (row references only) ---------- */
const issues = new Map();
const issue = (category, where) => { if (!issues.has(category)) issues.set(category, []); issues.get(category).push(where); };
// --repair: every change made to a row, written to the "Legacy Repairs" tab for the imported accounts.
const repairs = [];
/** A date before 2000 or after today is a typo (3/7/0226 for 3/7/2026), as unusable as a blank one. */
// The year must be four digits: "6/2/0202" is read as "202-06-02", which would otherwise sort between 2000 and today.
const plausibleDate = (date) => /^\d{4}-\d{2}-\d{2}$/.test(date ?? "") && date >= "2000-01-01" && date <= todayInManila();
const repaired = (row, change, before, after) => { repairs.push({ ref: row.ref, where: row.where, change, before: String(before ?? ""), after: String(after ?? "") }); issue(`Repaired: ${change}`, row.where); };

/* ---------- database lookups ---------- */
const dbTitles = ["Programs", "Branches", "Employees", "Members", "Member programs", "Sales", "Collections", "Beneficiaries"];
const { sheetsOnDb, appendSheetRows } = await import("../lib/sheets-on-db.ts");
const databaseRef = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DATABASE_URL ?? "")?.[1] ?? "unknown";
console.log(`Application data: Supabase project ${databaseRef}.`);
// Reading every table at once sometimes loses the connection ("CONNECTION_CLOSED", October 10, 2026): read them one at
// a time, retrying a dropped read up to three times (reads only, so a retry is safe).
async function readTable(range) {
  for (let attempt = 1; ; attempt++) {
    try { return (await sheetsOnDb.spreadsheets.values.get({ range, valueRenderOption: "UNFORMATTED_VALUE" })).data; }
    catch (error) {
      const dropped = /CONNECTION_CLOSED|ECONNRESET|CONNECTION_ENDED/.test(`${error?.message} ${error?.cause?.code} ${error?.cause?.message}`);
      if (!dropped || attempt >= 4) throw error;
      console.log(`  (the connection dropped while reading ${range}; trying again, attempt ${attempt + 1} of 4)`);
      await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
}
const dbResponse = { data: { valueRanges: [] } };
for (const title of dbTitles) dbResponse.data.valueRanges.push(await readTable(`'${title}'`));
const db = Object.fromEntries(dbTitles.map((t, i) => [t, dbResponse.data.valueRanges[i].values ?? []]));
// Programs column 22 (V) is flexible: basePay is then the minimum monthly payment (lib/account-rules.ts).
const programs = db.Programs.slice(1).filter((r) => str(r[0])).map((r) => ({ id: str(r[0]), code: str(r[1]), name: str(r[2]), basePay: Number(r[3]), payBalanceTotal: Number(r[12]) || 0, flexible: r[21] === true || /^(true|yes)$/i.test(str(r[21])) }));
const branches = db.Branches.slice(1).filter((r) => str(r[0])).map((r) => ({ id: str(r[0]), name: str(r[1]) }));
const employees = db.Employees.slice(1).filter((r) => str(r[0])).map((r) => ({ id: str(r[0]), name: str(r[1]) }));
const existingIds = new Set(dbTitles.slice(3).flatMap((t) => db[t].slice(1).map((r) => str(r[0]))));
const existingMemberNumbers = new Map(db.Members.slice(1).map((r) => [str(r[0]), str(r[1])]));
const usedMemberNumbers = new Set(db.Members.slice(1).map((r) => str(r[1])));

const programAliases = new Map(Object.entries(JSON.parse(readFileSync(PROGRAM_FILE, "utf8")).aliases).map(([k, v]) => [norm(k), norm(v)]));
const programCache = new Map();
const unknownLabels = new Set();
const findProgram = (v) => {
  const key = norm(v);
  if (!programCache.has(key)) { const code = programAliases.get(key) ?? key; programCache.set(key, programs.find((p) => norm(p.id) === code || norm(p.code) === code || norm(p.name) === code)); }
  return programCache.get(key);
};
const isD290500 = (label) => norm(label).replace(/\s+/g, "") === "D-290(500)";
const findBranch = (v) => { const o = override("branches", v); return branches.find((b) => [b.id, b.name].some((x) => norm(x) === norm(o ?? v))); };
// Old agents are written "SURNAME, I." : the employee with that surname whose first name starts with the initial.
const agentCache = new Map();
function findEmployee(v) {
  const key = norm(v);
  if (!key || key === "NONE" || /\bDTO\b/.test(key)) return undefined;
  if (agentCache.has(key)) return agentCache.get(key);
  const o = override("agents", v);
  let hits = o ? employees.filter((e) => e.id === o) : employees.filter((e) => norm(e.name) === key || coreKey(e.name) === coreKey(v));
  if (!hits.length && key.includes(",")) {
    const [surname, given = ""] = key.split(",").map((s) => s.trim());
    const surnameTokens = tokens(surname), initial = tokens(given)[0]?.[0];
    hits = employees.filter((e) => { const t = tokens(e.name); if (!surnameTokens.every((s) => t.includes(s))) return false; const rest = t.filter((x) => !surnameTokens.includes(x)); return !initial || rest[0]?.startsWith(initial); });
  }
  const found = hits.length === 1 ? hits[0] : undefined;
  agentCache.set(key, found);
  return found;
}
const channelOf = (status) => (/\bCOLLECTOR\b/.test(status) ? "Collector" : /\bDTO\b/.test(status) ? "DTO" : "MAS");

/* ---------- read the old workbook ---------- */
const saleRows = [];
const collectionRows = [];
const col = (keys, ...names) => { for (const n of names) { const i = keys.findIndex((k) => k === n || k.startsWith(n)); if (i >= 0) return i; } return -1; };
const sources = fromPending
  ? await loadLegacySources([DB], () => sheets, { tabPrefix: PENDING_PREFIX })
  : (await loadLegacySources(sourceArgs, () => sheets)).map((source) => (sourceTitle ? { ...source, title: sourceTitle } : source));
for (const source of sources) {
  for (const { title: tab, rows: tabRows, firstRow } of source.tabs) {
    const [headers = [], ...rows] = tabRows;
    const keys = headers.map(headerKey);
    const kind = keys.includes("nop") || keys.includes("month of") ? "collections" : keys.includes("type of transaction") || keys.includes("application no") ? "sales" : null;
    if (!kind) continue;
    // "M1-COLL" and "M1-NS" are territory M1.
    const territoryOf = (name) => norm(name).replace(/[\s-]*(COLL\w*|NS|NEW SALES?)$/, "").trim() || norm(name);
    // Rows copied to the Legacy Pending tabs carry their original source, tab, row, and assigned member.
    const origin = { source: keys.indexOf("source"), tab: keys.indexOf("source tab"), row: keys.indexOf("source row"), member: keys.indexOf("legacy member id") };
    const c = {
      timestamp: col(keys, "timestamp"), branch: col(keys, "branch"), agent: col(keys, "marketing agent"), member: col(keys, "ph/member"),
      orNumber: col(keys, "or number"), orDate: col(keys, "or date"), amount: col(keys, "amount collected"), dateRemitted: col(keys, "date remitted"),
      program: col(keys, "dayong program"), status: keys.lastIndexOf("status"),
      monthOf: col(keys, "month of"), nop: col(keys, "nop"), reactivation: col(keys, "reactivation"), transferred: col(keys, "transferred"), suspended: col(keys, "if suspended"), originalMas: keys.findIndex((k) => k.includes("original mas")),
      address: col(keys, "address"), civil: col(keys, "civil status"), birthdate: col(keys, "birthdate"), type: col(keys, "type of transaction"),
      regFee: col(keys, "with regi"), regAmount: col(keys, "registration amount"), applicationNo: col(keys, "application no"),
    };
    // New Sales: AGE right after BIRTHDATE is the member's; the first NAME + CONTACT NO is the claimant; then NAME/AGE/RELATIONSHIP groups are beneficiaries.
    const nameColumns = keys.flatMap((k, i) => (k === "name" ? [i] : []));
    const claimantName = nameColumns[0] ?? -1;
    const claimantContact = keys.findIndex((k, i) => i > claimantName && k.startsWith("contact"));
    const beneficiaryColumns = nameColumns.slice(1).filter((i) => keys[i + 1] === "age" && keys[i + 2] === "relationship");
    rows.forEach((row, index) => {
      if (!row.some((v) => str(v))) return;
      const get = (i) => (i >= 0 ? row[i] : "");
      const sourceTitle = str(get(origin.source)) || source.title, sourceTab = str(get(origin.tab)) || tab;
      const rowNumber = Number(get(origin.row)) || firstRow + index + 1; // as shown in Excel
      const where = `${sourceTitle} › ${sourceTab} row ${rowNumber}`;
      // Keyed by the source's name (not its path) so re-running from a re-downloaded copy skips imported rows.
      const ref = `${sourceTitle}|${sourceTab}|${rowNumber}`;
      const base = { where, ref, kind, territory: territoryOf(sourceTab), raw: row, headers, legacyMemberId: overrides.members?.[str(get(origin.member))] ?? str(get(origin.member)), timestamp: get(c.timestamp), branch: str(get(c.branch)), agent: str(get(c.agent)), member: str(get(c.member)), orNumber: reference(get(c.orNumber)), orDate: get(c.orDate), amount: get(c.amount), dateRemitted: get(c.dateRemitted), program: str(get(c.program)), status: norm(get(c.status)) };
      if (!base.member) return; // blank or summary rows
      if (kind === "sales") saleRows.push({ ...base, address: str(get(c.address)), civil: str(get(c.civil)), birthdate: get(c.birthdate), age: numberOrBlank(get(keys[c.birthdate + 1] === "age" ? c.birthdate + 1 : -1)), type: norm(get(c.type)), regFee: get(c.regFee), regAmount: numberOrBlank(get(c.regAmount)), applicationNo: str(get(c.applicationNo)), claimantName: str(get(claimantName)), claimantContact: str(get(claimantContact)), beneficiaries: beneficiaryColumns.map((i) => ({ name: str(row[i]), age: numberOrBlank(row[i + 1]), relationship: str(row[i + 2]) })).filter((b) => b.name && !/^N\/?A$/i.test(b.name)) });
      else collectionRows.push({ ...base, monthOf: get(c.monthOf), nop: get(c.nop), reactivation: get(c.reactivation), transferred: get(c.transferred), suspended: str(get(c.suspended)), originalMas: norm(get(c.originalMas)) === "NONE" ? "" : str(get(c.originalMas)) });
    });
  }
}

/* ---------- 1. New Sales -> members and enrollments ---------- */
const members = []; // { id, name, birthdate, territory, parsed, first, enrollments: Map(programId -> enrollment) }
const enrollments = []; // { id, member, program, sale?, rows: [] }
const membersById = new Map();
const newEnrollment = (member, program, sale) => { const e = { id: hashId("ENR", member.id, program.id), member, program, sale, rows: [] }; member.enrollments.set(program.id, e); enrollments.push(e); return e; };
for (const sale of saleRows) {
  sale.program$ = findProgram(sale.program);
  sale.branch$ = findBranch(sale.branch);
  sale.agent$ = findEmployee(sale.agent);
  const doi = parseDate(sale.orDate);
  sale.doi = doi.date;
  sale.birth = parseDate(sale.birthdate).date;
  if (doi.flag) issue(`OR DATE read as ${doi.flag}`, sale.where);
  if (repair && !plausibleDate(sale.doi) && plausibleDate(parseDate(sale.dateRemitted).date)) {
    sale.doi = parseDate(sale.dateRemitted).date;
    repaired(sale, "OR DATE unreadable: DATE REMITTED used", sale.orDate, sale.doi);
  }
  // D-290 (500) is two programs by DOI (owner, October 9, 2026): D-290 before August 2026, DSP-290 from then.
  if (isD290500(sale.program) && sale.doi) sale.program$ = findProgram(sale.doi >= "2026-08-01" ? "DSP-290" : "D-290");
  if (!sale.program$) unknownLabels.add(sale.program);
  if (!sale.program$) { issue(`DAYONG PROGRAM "${sale.program}" not in config/legacy-programs.json or Programs`, sale.where); continue; }
  if (!sale.branch$) { issue("BRANCH not found in Branches", sale.where); continue; }
  if (!sale.doi) { issue("OR DATE (used as DOI) missing or unreadable", sale.where); continue; }
  if (!sale.agent$) issue("MARKETING AGENT not in Employees (old name kept; no accountable employee)", sale.where);
  const parsed = parseName(sale.member);
  if (parsed.guessed) issue("Name has no comma: surname/first name split was guessed", sale.where);
  if (sale.legacyMemberId) {
    // Already assigned to a member by the first run.
    let member = membersById.get(sale.legacyMemberId);
    if (!member) { member = { id: sale.legacyMemberId, name: sale.member, birthdate: sale.birth, territory: sale.territory, parsed, first: sale, enrollments: new Map() }; members.push(member); membersById.set(member.id, member); indexName(sale.member, member); }
    sale.memberId = member.id;
    if (member.enrollments.has(sale.program$.id)) { issue("Same member already bought this program on an earlier row: sale skipped", sale.where); continue; }
    newEnrollment(member, sale.program$, sale);
    continue;
  }
  // Same person: same core name (or one lacks a middle name) and birthdates that agree or are blank.
  const nearby = nameCandidates(sale.member);
  const candidates = nearby.filter((m) => sameish(m.name, sale.member) && (!m.birthdate || !sale.birth || m.birthdate === sale.birth));
  let member = candidates.length === 1 ? candidates[0] : undefined;
  if (candidates.length > 1) { const exact = candidates.filter((m) => coreKey(m.name) === coreKey(sale.member)); member = exact.length === 1 ? exact[0] : undefined; if (!member) issue("Name matches more than one earlier member: kept as a separate member", sale.where); }
  if (!member && nearby.some((m) => sameish(m.name, sale.member))) issue("Same name as another member but different birthdate: kept as a separate member", sale.where);
  if (!member) {
    member = { id: hashId("MEM", sale.ref), name: sale.member, birthdate: sale.birth, territory: sale.territory, parsed, first: sale, enrollments: new Map() };
    members.push(member);
    membersById.set(member.id, member);
    indexName(sale.member, member);
  } else if (!member.birthdate && sale.birth) member.birthdate = sale.birth;
  sale.memberId = member.id;
  if (member.enrollments.has(sale.program$.id)) { issue("Same member already bought this program on an earlier row: sale skipped", sale.where); continue; }
  newEnrollment(member, sale.program$, sale);
}

/* ---------- 2. Collections -> New Sales enrollments ---------- */
// Strictest name rule first; among equal matches prefer the same territory, then the same branch.
function pickByName(pool, name, row, getName) {
  for (const rule of NAME_RULES) {
    let hits = pool.filter((item) => rule(getName(item), name));
    if (!hits.length) continue;
    for (const narrow of [(i) => i.territory === row.territory, (i) => norm(i.branch) === norm(row.branch)]) {
      if (hits.length > 1) { const narrowed = hits.filter(narrow); if (narrowed.length) hits = narrowed; }
    }
    return hits.length === 1 ? hits[0] : null;
  }
  return undefined;
}
const pending = [];
let linkedToSales = 0, nameOnlyMembers = 0;
// D-290 (500) payments of a member with no New Sale in the sheet: the member's earliest such payment stands for the DOI.
const firstD290500 = new Map();
for (const row of collectionRows) {
  if (!isD290500(row.program) || !row.legacyMemberId) continue;
  const date = parseDate(row.orDate).date;
  if (date && (!firstD290500.has(row.legacyMemberId) || date < firstD290500.get(row.legacyMemberId))) firstD290500.set(row.legacyMemberId, date);
}
for (const row of collectionRows) {
  const leftOut = overrides.leaveOut?.[row.ref];
  if (leftOut) { issue(`Left out by the owner: ${leftOut}`, row.where); continue; }
  // Owner corrections of a single row (October 9, 2026): the right program or amount, recorded as repairs.
  const program = overrides.programs?.[row.ref]?.program, amount = overrides.amounts?.[row.ref]?.amount;
  if (program && program !== row.program) { repaired(row, `DAYONG PROGRAM corrected by the owner: ${overrides.programs[row.ref].note}`, row.program, program); row.program = program; }
  if (amount && Number(amount) !== Number(String(row.amount).replace(/[^0-9.]/g, ""))) { repaired(row, `AMOUNT COLLECTED corrected by the owner: ${overrides.amounts[row.ref].note}`, row.amount, amount); row.amount = amount; }
  row.program$ = findProgram(row.program);
  // A D-290 (500) payment follows the member's D-290 or DSP-290 account from the New Sales (split by DOI above).
  if (isD290500(row.program)) {
    const d290 = [findProgram("D-290"), findProgram("DSP-290")].filter(Boolean).map((p) => p.id);
    const owner = row.legacyMemberId ? membersById.get(row.legacyMemberId) : undefined;
    const account = owner ? [...owner.enrollments.values()].find((e) => d290.includes(e.program.id)) : undefined;
    const firstPaid = row.legacyMemberId ? firstD290500.get(row.legacyMemberId) : undefined;
    row.program$ = account?.program ?? (firstPaid ? findProgram(firstPaid >= "2026-08-01" ? "DSP-290" : "D-290") : undefined);
    if (!row.program$) { issue(`DAYONG PROGRAM "${row.program}": no D-290 or DSP-290 New Sale or dated payment of this member to tell which (by DOI)`, row.where); continue; }
  }
  if (!row.program$) unknownLabels.add(row.program);
  if (!row.program$) { issue(`DAYONG PROGRAM "${row.program}" not in config/legacy-programs.json or Programs`, row.where); continue; }
  if (row.legacyMemberId) {
    let member = membersById.get(row.legacyMemberId);
    if (!member) { member = { id: row.legacyMemberId, name: row.member, birthdate: "", territory: row.territory, parsed: parseName(row.member), first: null, enrollments: new Map() }; members.push(member); membersById.set(member.id, member); nameOnlyMembers++; }
    (member.enrollments.get(row.program$.id) ?? newEnrollment(member, row.program$, null)).rows.push(row);
    linkedToSales++;
    continue;
  }
  const pool = nameCandidates(row.member).flatMap((m) => { const e = m.enrollments.get(row.program$.id); return e ? [{ e, territory: m.territory, branch: e.sale?.branch ?? "", name: m.name }] : []; });
  const hit = pickByName(pool, row.member, row, (i) => i.name);
  if (hit === null) { issue("Payer name matches several New Sales members in this program: not linked", row.where); continue; }
  if (hit) { hit.e.rows.push(row); linkedToSales++; } else pending.push(row);
}

/* ---------- 3. Payers with no New Sale -> name-only members ---------- */
// One group per territory and name; a name lacking only the middle name joins the one fuller name it fits.
const groups = new Map();
for (const row of pending) {
  const key = `${row.territory}|${coreKey(row.member)}`;
  if (!groups.has(key)) groups.set(key, { key, territory: row.territory, core: coreTokens(row.member), rows: [] });
  groups.get(key).rows.push(row);
}
const groupsByTerritory = Map.groupBy(groups.values(), (g) => g.territory);
for (const group of groups.values()) {
  if (group.core.length < 2) continue;
  const fuller = groupsByTerritory.get(group.territory).filter((g) => g !== group && !g.mergedInto && g.core.length > group.core.length && group.core.every((t) => g.core.includes(t)));
  if (fuller.length === 1) { group.mergedInto = fuller[0]; fuller[0].rows.push(...group.rows); group.rows = []; }
}
for (const group of groups.values()) {
  if (!group.rows.length) continue;
  // Reuse a New Sales member with this name in the same territory (a second program bought before the log).
  const spellings = mode(group.rows.map((r) => norm(r.member))).value;
  const sameTerritory = nameCandidates(spellings).filter((m) => m.territory === group.territory);
  let member = pickByName(sameTerritory, spellings, { territory: group.territory, branch: "" }, (m) => m.name);
  if (!member) {
    member = { id: hashId("MEM", "COLL", group.key), name: spellings, birthdate: "", territory: group.territory, parsed: parseName(spellings), first: null, enrollments: new Map() };
    members.push(member);
    membersById.set(member.id, member);
    nameOnlyMembers++;
    if (member.parsed.guessed) issue("Name has no comma: surname/first name split was guessed", group.rows[0].where);
  }
  for (const row of group.rows) (member.enrollments.get(row.program$.id) ?? newEnrollment(member, row.program$, null)).rows.push(row);
}

/* ---------- 4. Payments: months from NOP, then the system's account check ---------- */
// The program's monthly rate; without one, the most common amount paid per month for that program in these rows.
const usualRate = new Map();
for (const e of enrollments) for (const row of e.rows) {
  const nop = parseNop(row.nop), amount = parseAmount(row.amount);
  if (!nop || !(amount > 0)) continue;
  const perMonth = Math.round(amount / (nop.to - nop.from + 1) * 100) / 100;
  const counts = usualRate.get(e.program.id) ?? new Map();
  counts.set(perMonth, (counts.get(perMonth) ?? 0) + 1);
  usualRate.set(e.program.id, counts);
}
const rateFor = (program) => program.basePay > 0 ? program.basePay : [...(usualRate.get(program.id) ?? new Map())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
// --repair: payments renumbered consecutively in OR-date order, each covering the months its amount pays.
function renumberAll(e, doiIndex) {
  const rate = rateFor(e.program);
  const ordered = [...e.payments].sort((a, b) => a.orDate.localeCompare(b.orDate) || (a.dateRemitted || "").localeCompare(b.dateRemitted || "") || (a.nopFrom || Infinity) - (b.nopFrom || Infinity));
  const written = ordered.filter((p) => p.nopFrom > 0).map((p) => p.nopFrom);
  let next = e.sale ? 2 : e.doiFromFirstOr || !written.length ? 1 : Math.min(...written);
  const rateCents = Math.round(rate * 100);
  // Every payment must be exactly a whole number of monthly payments; otherwise the account is left for review.
  // A flexible program takes any amount from its minimum: each full minimum in a payment is one month.
  const inexact = ordered.filter((p) => e.program.flexible ? !(rateCents > 0 && Math.round(p.amount * 100) >= rateCents) : !(rateCents > 0 && Math.round(p.amount * 100) % rateCents === 0 && Math.round(p.amount * 100) >= rateCents));
  if (inexact.length) {
    e.inexact = inexact.map((p) => `${p.row.where}: ₱${p.amount} at ₱${rate}/month`);
    return null;
  }
  return ordered.map((p) => {
    const count = e.program.flexible ? Math.floor(Math.round(p.amount * 100) / rateCents) : Math.round(p.amount * 100) / rateCents;
    const from = next;
    next += count;
    if (from === p.nopFrom && from + count - 1 === p.nopTo) return p;
    repaired(p.row, "NOP renumbered in OR-date order", p.nopFrom > 0 ? `NOP ${p.nopFrom}-${p.nopTo}` : "NOP unreadable", `NOP ${from}-${from + count - 1}`);
    return { ...p, nopFrom: from, nopTo: from + count - 1, monthFrom: monthName(doiIndex + from - 1), monthTo: monthName(doiIndex + from + count - 2) };
  });
}
// A failing account whose payments, renumbered consecutively in OR-date order, pass review with at most 2 NOPs changed.
let typoFixable = 0;
function nopTypoFix(e, doiIndex, account) {
  try { accountState(account, e.payments, today); return null; } catch { /* fails as recorded: try renumbering */ }
  const ordered = [...e.payments].sort((a, b) => a.orDate.localeCompare(b.orDate) || a.nopFrom - b.nopFrom);
  let next = Math.min(...ordered.map((p) => p.nopFrom));
  const payments = ordered.map((p) => {
    const span = p.nopTo - p.nopFrom, from = next;
    next += span + 1;
    return from === p.nopFrom ? p : { ...p, nopFrom: from, nopTo: from + span, monthFrom: monthName(doiIndex + from - 1), monthTo: monthName(doiIndex + from + span - 1) };
  });
  const changed = payments.filter((p, i) => p !== ordered[i]);
  if (!changed.length || changed.length > 2) return null;
  try { accountState(account, payments, today); return { payments, changed }; } catch { return null; }
}
// Why a failing account fails, in counts (shown in the report): gap sizes, reactivations, and overlap kinds.
const diagnosis = new Map();
const note = (label) => diagnosis.set(label, (diagnosis.get(label) ?? 0) + 1);
function diagnose(e) {
  const sorted = [...e.payments].sort((a, b) => a.nopFrom - b.nopFrom || a.orDate.localeCompare(b.orDate));
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1], after = sorted[i];
    if (after.nopFrom <= before.nopTo) note(norm(after.orNumber) && norm(after.orNumber) === norm(before.orNumber) ? "overlap: same OR number, different NOP" : after.orDate === before.orDate ? "overlap: same OR date, different OR number" : "overlap: different receipts claim the same NOP");
    else if (after.nopFrom > before.nopTo + 1) {
      const missing = after.nopFrom - before.nopTo - 1;
      note(`gap: ${missing === 1 ? "1 NOP" : missing <= 3 ? "2-3 NOPs" : missing <= 12 ? "4-12 NOPs" : "over 12 NOPs"} missing${yesNo(after.row.reactivation) === "Yes" ? " (next payment marked REACTIVATION)" : ""}`);
    }
  }
}
const today = todayInManila();
const statusCounts = new Map();
let mismatchedInactive = 0;
for (const e of enrollments) {
  const parsed = [];
  for (const row of e.rows) {
    let orDate = parseDate(row.orDate).date;
    let nop = parseNop(row.nop);
    let amount = parseAmount(row.amount);
    if (repair) {
      const rate = rateFor(e.program);
      if (!plausibleDate(orDate) && plausibleDate(parseDate(row.dateRemitted).date)) { orDate = parseDate(row.dateRemitted).date; repaired(row, "OR DATE unreadable: DATE REMITTED used", row.orDate, orDate); }
      if (!(amount > 0) && rate > 0) { amount = Math.round(rate * (nop ? nop.to - nop.from + 1 : 1) * 100) / 100; repaired(row, "AMOUNT COLLECTED unreadable: program rate used", row.amount, amount); }
      // An unreadable NOP is numbered with the others in OR-date order below.
      if (!nop && amount > 0) nop = { from: 0, to: 0, unknown: true };
    }
    const problems = [!orDate && "OR DATE missing or unreadable", !nop && "NOP unreadable", !(amount > 0) && "AMOUNT COLLECTED missing or not a positive number"].filter(Boolean);
    if (problems.length) { for (const p of problems) issue(`Collection: ${p}`, row.where); e.unreadable = true; continue; }
    parsed.push({ row, orDate, nop, amount, monthNames: parseMonthNames(row.monthOf) });
  }
  // DOI month: the sale's OR date, or worked back from each payment (its first month nearest its OR date, minus NOP - 1).
  const estimates = parsed.filter((p) => p.monthNames && !p.nop.unknown).map((p) => {
    const orIndex = monthIndex(p.orDate.slice(0, 7));
    let first = Math.floor(orIndex / 12) * 12 + p.monthNames[0] - 1;
    while (first - orIndex > 6) first -= 12;
    while (orIndex - first > 5) first += 12;
    return first - (p.nop.from - 1);
  });
  const estimate = mode(estimates);
  if (e.sale) {
    e.doi = e.sale.doi;
    if (estimate && estimate.value !== monthIndex(e.doi.slice(0, 7))) issue("New Sale DOI month differs from the month its collection NOPs point to (sale DOI used)", e.sale.where);
  } else if (estimate) {
    e.doi = `${monthName(estimate.value)}-01`;
    if (estimate.share < 0.8) issue("Payments disagree on the DOI month (most common used): review NOP/MONTH OF", e.rows[0].where);
  } else if (repair && parsed.length) {
    e.doi = [...parsed].sort((a, b) => a.orDate.localeCompare(b.orDate))[0].orDate;
    e.doiFromFirstOr = true;
    repaired(parsed[0].row, "No usable DOI: first OR date used", "", e.doi);
  } else { e.invalid = "no payment has a readable MONTH OF to work out the DOI"; }
  // A New Sale without a valid DOI: the first OR date, when repairing.
  if (repair && e.sale && !/^\d{4}-\d{2}-\d{2}$/.test(e.doi ?? "") && parsed.length) {
    e.doi = [...parsed].sort((a, b) => a.orDate.localeCompare(b.orDate))[0].orDate;
    e.doiFromFirstOr = true;
    repaired(e.sale, "New Sale DOI invalid: first OR date used", "", e.doi);
  }
  if (e.invalid || e.unreadable) { e.invalid ??= "has collection rows that could not be read"; issue(`Account fails review: ${e.invalid}`, (e.sale ?? e.rows[0]).where); continue; }

  const doiIndex = monthIndex(e.doi.slice(0, 7));
  e.payments = [];
  // The same receipt entered twice (same NOP and OR number, or same NOP, OR date, and amount without an OR number).
  const seen = new Set(), seenReceipts = new Set();
  for (const p of parsed) {
    const entry = `${p.nop.from}-${p.nop.to}|${norm(p.row.orNumber) || `${p.orDate}|${p.amount}`}`;
    if (seen.has(entry)) { issue("Same payment entered twice: duplicate skipped", p.row.where); continue; }
    seen.add(entry);
    // --repair: one OR number is one receipt; a second row with it is the same payment entered again.
    if (repair && norm(p.row.orNumber)) {
      if (seenReceipts.has(norm(p.row.orNumber))) { repaired(p.row, "Same OR number twice on the account: one kept", p.row.orNumber, "not imported"); continue; }
      seenReceipts.add(norm(p.row.orNumber));
    }
    if (p.nop.unknown) {
      const agent = findEmployee(p.row.agent);
      e.payments.push({ id: hashId("COL", p.row.ref), row: p.row, enrollmentId: e.id, orDate: p.orDate, orNumber: p.row.orNumber, monthFrom: "", monthTo: "", nopFrom: 0, nopTo: 0, amount: p.amount, dateRemitted: parseDate(p.row.dateRemitted).date, mas: agent?.name ?? p.row.agent, agent, channel: channelOf(p.row.status) });
      continue;
    }
    if (e.sale && p.nop.from === 1) { if (p.nop.to === 1) { issue("NOP 1 collection repeats the New Sale: skipped", p.row.where); continue; } p.nop = { ...p.nop, from: 2 }; }
    const monthFrom = monthName(doiIndex + p.nop.from - 1), monthTo = monthName(doiIndex + p.nop.to - 1);
    const expected = Array.from({ length: p.nop.to - p.nop.from + 1 }, (_, i) => ((doiIndex + p.nop.from - 1 + i) % 12) + 1);
    if (!p.monthNames) issue("MONTH OF unreadable (months taken from NOP)", p.row.where);
    else if (p.monthNames.join() !== expected.join()) issue("MONTH OF differs from the months its NOP points to (NOP used)", p.row.where);
    const agent = findEmployee(p.row.agent);
    e.payments.push({ id: hashId("COL", p.row.ref), row: p.row, enrollmentId: e.id, orDate: p.orDate, orNumber: p.row.orNumber, monthFrom, monthTo, nopFrom: p.nop.from, nopTo: p.nop.to, amount: p.amount, dateRemitted: parseDate(p.row.dateRemitted).date, mas: agent?.name ?? p.row.agent, agent, channel: channelOf(p.row.status) });
  }
  // Current assignment: the latest payment collected by the MAS (else the latest payment, else the sale).
  const byDate = [...e.payments].sort((a, b) => a.orDate.localeCompare(b.orDate));
  const latest = byDate.filter((p) => p.channel === "MAS").at(-1) ?? byDate.at(-1);
  e.branch = findBranch(latest?.row.branch ?? e.sale?.branch) ?? e.sale?.branch$;
  const assigned = latest ? (latest.channel === "Collector" && latest.row.originalMas ? latest.row.originalMas : latest.row.agent) : e.sale?.agent;
  e.mas = findEmployee(assigned)?.name ?? assigned ?? "";
  if (!e.branch) { e.invalid = "branch not found in Branches"; issue(`Account fails review: ${e.invalid}`, (e.sale ?? e.rows[0]).where); continue; }
  // Pending rows of an account already in the database were skipped on purpose (duplicates, NOP 1 repeats of a sale):
  // only whole accounts that failed review are migrated from the Legacy Pending tabs.
  if (fromPending && existingIds.has(e.id)) { e.alreadyImported = true; e.invalid = "account is already in the database (row was skipped on purpose)"; issue(`Not migrated: ${e.invalid}`, (e.sale ?? e.rows[0]).where); continue; }
  const account = { id: e.id, memberId: e.member.id, memberNumber: "", programId: e.program.id, doi: e.doi, branch: "", mas: "", basePay: e.program.basePay, payBalanceTotal: e.program.payBalanceTotal, storedStatus: "", flexible: e.program.flexible };
  // --repair: an account that fails as recorded (or has an unreadable NOP) is renumbered by rule.
  if (repair) {
    let passes = !e.payments.some((p) => p.nopFrom === 0);
    if (passes) { try { accountState(account, e.payments, today); } catch { passes = false; } }
    if (!passes) {
      const renumberedAll = renumberAll(e, doiIndex);
      if (!renumberedAll) { e.invalid = "payment is not a whole number of monthly payments"; issue(`Not imported: ${e.invalid}`, (e.sale ?? e.rows[0]).where); continue; }
      e.payments = renumberedAll;
    }
  }
  const renumbered = repair ? null : nopTypoFix(e, doiIndex, account);
  if (renumbered) {
    typoFixable++;
    if (fixNopTypos) { for (const p of renumbered.changed) issue("NOP looked mistyped: renumbered in OR-date order", p.row.where); e.payments = renumbered.payments; }
  }
  try {
    const state = accountState(account, e.payments, today);
    e.status = state.status;
    statusCounts.set(state.status, (statusCounts.get(state.status) ?? 0) + 1);
    if ((byDate.at(-1)?.row.status ?? e.sale?.status) === "INACTIVE" && !["Forfeited", "Paid"].includes(state.status)) mismatchedInactive++;
  } catch (error) {
    e.invalid = error.message.replace(/^(Payment|Account) \S+ /, "");
    issue(`Account fails review: ${e.invalid}`, (e.sale ?? e.rows[0]).where);
    diagnose(e);
  }
}

/* ---------- report ---------- */
const valid = enrollments.filter((e) => !e.invalid);
const invalid = enrollments.filter((e) => e.invalid);
const paymentsIn = (list) => list.reduce((n, e) => n + (e.payments?.length ?? e.rows.length), 0);
console.log(`Read ${saleRows.length} New Sales rows and ${collectionRows.length} Collections rows from ${sources.length} workbook(s).`);
console.log(`Members: ${members.length}  (${members.length - nameOnlyMembers} from New Sales, ${nameOnlyMembers} name-only from Collections)`);
console.log(`Collections: ${linkedToSales} linked to a New Sale, ${pending.length} to a name-only member.`);
console.log(`Enrollments: ${enrollments.length}  ·  pass review: ${valid.length} (${paymentsIn(valid)} payments)  ·  fail review: ${invalid.length} (${paymentsIn(invalid)} payments)`);
console.log(`Computed account statuses (passing accounts): ${JSON.stringify(Object.fromEntries([...statusCounts].sort((a, b) => b[1] - a[1])))}`);
console.log(`Old STATUS "Inactive" but the system computes an open account: ${mismatchedInactive}`);
console.log(`Accounts that pass if mistyped NOPs are renumbered in OR-date order: ${typoFixable}${fixNopTypos ? " (renumbered)" : " (add --fix-nop-typos to apply)"}`);
console.log(`\nWhy failing accounts fail (one count per problem spot):`);
for (const [label, count] of [...diagnosis].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)} × ${label}`);
console.log("\nIssues (count · first examples):");
for (const [category, wheres] of [...issues].sort((a, b) => b[1].length - a[1].length)) console.log(`  ${wheres.length} × ${category}\n      e.g. ${wheres.slice(0, 3).join("; ")}`);
const inexactAccounts = enrollments.filter((e) => e.inexact);
if (inexactAccounts.length) {
  console.log(`\nPayments that are not a whole number of monthly payments (${inexactAccounts.length} account(s) not imported):`);
  for (const e of inexactAccounts) console.log(`  ${e.program.code}: ${e.inexact.join("; ")}`);
}
mkdirSync("backups", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const reportFile = `backups/legacy-migration-report-${stamp}.txt`;
writeFileSync(reportFile, [...issues].map(([category, wheres]) => `## ${category} (${wheres.length})\n${wheres.join("\n")}`).join("\n\n"));
console.log(`\nFull list of row references: ${reportFile}`);

if (exportPending) await writePendingTabs();
if (dropExisting) {
  if (!fromPending) throw new Error("--drop-existing works on the Legacy Pending tabs; add --pending.");
  const refs = new Set(enrollments.filter((e) => e.alreadyImported).flatMap((e) => [e.sale?.ref, ...e.rows.map((row) => row.ref)].filter(Boolean)));
  const removed = await removePendingRows(refs, !apply);
  console.log(`
${apply ? "Removed" : "Would remove"} ${removed.ns} New Sales and ${removed.coll} Collections row(s) of ${enrollments.filter((e) => e.alreadyImported).length} account(s) already in the database.`);
  process.exit(0);
}
// Receipt and application numbers already in use (the database allows each once) are imported flagged as duplicates.
const entryKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const usedOr = new Set(db.Collections.slice(1).filter((r) => str(r[19]).toLowerCase() === "posted").map((r) => entryKey(r[8])).filter(Boolean));
const usedApplications = new Set(db.Sales.slice(1).map((r) => entryKey(r[28])).filter(Boolean));
const duplicateFlags = (rows, keyIndex, used) => rows.map((row) => { const key = entryKey(row[keyIndex]); const duplicate = Boolean(key && used.has(key)); if (key) used.add(key); return { legacy_duplicate: duplicate }; });

// A newer download of the workbook (--source-title, October 8, 2026): new payments on an account already in the database
// are checked against the payments the database holds for it (repairs or later edits may number them differently from
// this file). If they do not fit, they are held back and listed instead of written.
const storedDoi = new Map(db["Member programs"].slice(1).map((r) => [str(r[0]), parseDate(r[4]).date]));
const storedPayments = new Map();
for (const r of db.Collections.slice(1)) {
  if (str(r[19]).toLowerCase() !== "posted" || !str(r[2])) continue;
  const list = storedPayments.get(str(r[2])) ?? storedPayments.set(str(r[2]), []).get(str(r[2]));
  list.push({ id: str(r[0]), enrollmentId: str(r[2]), orDate: parseDate(r[9]).date, orNumber: str(r[8]), monthFrom: str(r[11]), monthTo: str(r[12]), nopFrom: Number(r[13]), nopTo: Number(r[14]), amount: Number(r[10]), dateRemitted: "", mas: "" });
}
const heldNew = [];
// An account the database no longer has, with no New Sale and every payment already in the database under another
// account, was merged into that account (scripts/merge-name-variants.mjs): it is not created again.
const mergedAway = valid.filter((e) => !existingIds.has(e.id) && !e.sale && e.payments.length && e.payments.every((pay) => existingIds.has(pay.id)));
if (mergedAway.length) {
  for (const e of mergedAway) valid.splice(valid.indexOf(e), 1);
  console.log(`
${mergedAway.length} account(s) were merged into another account earlier (all their payments are there): not created again.`);
}
// A new account some of whose payments the database already has under another account would split one person's history
// (e.g. a New Sale row added later for someone imported from collections only): held back and listed for review.
let splitting = valid.filter((e) => !existingIds.has(e.id) && e.payments.some((pay) => existingIds.has(pay.id)));
// Accounts moved or merged in this system since the first import (October 8–10, 2026: draft programs into finalized
// ones, merges) are in another program, so their ID no longer matches: when every payment the database already has
// sits in one account, that account is this one; new payments go there (and are checked against its history below).
const enrollmentOfPayment = new Map(db.Collections.slice(1).map((r) => [str(r[0]), str(r[2])]));
const storedAccount = new Map(db["Member programs"].slice(1).map((r) => [str(r[0]), { memberId: str(r[1]), number: str(r[2]), programId: str(r[3]) }]));
let redirected = 0;
const redirect = (e, target) => {
  const stored = storedAccount.get(target);
  if (!stored) return false;
  e.id = target;
  e.redirect = stored;
  e.program = programs.find((p) => p.id === stored.programId) ?? e.program;
  for (const pay of e.payments) pay.enrollmentId = target;
  redirected++;
  return true;
};
// The account a stored New Sale belongs to now (its member number and program, moves included), and each member's
// account per program: one member has one account per program, so a "new" one would be a second copy.
const saleAccount = new Map(db.Sales.slice(1).map((r) => [str(r[0]), `${str(r[5])}|${str(r[21])}`]));
const accountByNumberProgram = new Map(db["Member programs"].slice(1).map((r) => [`${str(r[2])}|${str(r[3])}`, str(r[0])]));
const accountByMemberProgram = new Map(db["Member programs"].slice(1).map((r) => [`${str(r[1])}|${str(r[3])}`, str(r[0])]));
for (const e of valid.filter((item) => !existingIds.has(item.id))) {
  // 1. Its New Sale is already stored: the account that sale belongs to now.
  const saleId = e.sale ? hashId("SALE", e.sale.ref) : "";
  if (saleId && saleAccount.has(saleId)) { const target = accountByNumberProgram.get(saleAccount.get(saleId)); if (target && redirect(e, target)) continue; }
  // 2. The member already has an account in this program.
  const own = existingIds.has(e.member.id) ? accountByMemberProgram.get(`${e.member.id}|${e.program.id}`) : undefined;
  if (own && redirect(e, own)) continue;
  // 3. Every payment the database already has sits in one account.
  const targets = new Set(e.payments.filter((pay) => existingIds.has(pay.id)).map((pay) => enrollmentOfPayment.get(pay.id)).filter(Boolean));
  const saleIsNew = e.sale && !existingIds.has(saleId);
  if (targets.size === 1 && !saleIsNew) redirect(e, [...targets][0]);
}
splitting = splitting.filter((e) => !e.redirect);
if (redirected) console.log(`
${redirected} account(s) moved or merged in this system since the first import: their new payments go to the account they are in now.`);
if (splitting.length) {
  for (const e of splitting) valid.splice(valid.indexOf(e), 1);
  console.log(`
${splitting.length} new account(s) held back: part of their payments are already in the database under another account (review, e.g. a New Sale added later):`);
  for (const e of splitting) console.log(`  ${(e.sale ?? e.rows[0]).where}: ${e.payments.filter((pay) => existingIds.has(pay.id)).length} payment(s) already elsewhere, ${e.payments.filter((pay) => !existingIds.has(pay.id)).length} new`);
}
// A new row whose receipt (OR number digits, OR date and amount) is already posted in the database was encoded twice,
// in the old sheet and in this system since October 5: it is skipped, not imported again.
const digitsOf = (value) => str(value).replace(/\D/g, "").replace(/^0+/, "");
const postedReceipts = new Set(db.Collections.slice(1).filter((r) => str(r[19]).toLowerCase() === "posted").map((r) => `${digitsOf(r[8])}|${parseDate(r[9]).date}|${Number(r[10])}`));
let alreadyEncoded = 0;
for (const e of valid) {
  const before = e.payments.length;
  e.payments = e.payments.filter((pay) => existingIds.has(pay.id) || !digitsOf(pay.orNumber) || !postedReceipts.has(`${digitsOf(pay.orNumber)}|${pay.orDate}|${Number(pay.amount)}`));
  alreadyEncoded += before - e.payments.length;
}
if (alreadyEncoded) console.log(`
${alreadyEncoded} new collection row(s) are already in the database with the same OR number, OR date and amount (encoded in this system too): skipped.`);
for (const e of valid) {
  if (!existingIds.has(e.id)) continue;
  const fresh = e.payments.filter((pay) => !existingIds.has(pay.id));
  if (!fresh.length) continue;
  const account = { id: e.id, memberId: e.member.id, memberNumber: "", programId: e.program.id, doi: storedDoi.get(e.id) || e.doi, branch: "", mas: "", basePay: e.program.basePay, payBalanceTotal: e.program.payBalanceTotal, storedStatus: "", flexible: e.program.flexible };
  try { accountState(account, [...(storedPayments.get(e.id) ?? []), ...fresh], today); }
  catch (error) {
    e.payments = e.payments.filter((pay) => existingIds.has(pay.id));
    heldNew.push(...fresh.map((pay) => `${pay.row.where}: ${error.message.replace(/^(Payment|Account) \S+ /, "")}`));
  }
}
const writtenMembers0 = new Set();
const newCounts = { members: 0, accounts: 0, sales: 0, payments: 0, paymentsOnExistingAccounts: 0 };
for (const e of valid) {
  if (!e.redirect && !existingIds.has(e.member.id) && !writtenMembers0.has(e.member.id)) { writtenMembers0.add(e.member.id); newCounts.members++; }
  if (!existingIds.has(e.id)) newCounts.accounts++;
  if (e.sale && !existingIds.has(hashId("SALE", e.sale.ref))) newCounts.sales++;
  const fresh = e.payments.filter((pay) => !existingIds.has(pay.id)).length;
  newCounts.payments += fresh;
  if (existingIds.has(e.id)) newCounts.paymentsOnExistingAccounts += fresh;
}
// Unknown program labels: the programs here that carry the same number, so the right one can be put in
// config/legacy-programs.json (aliases).
if (unknownLabels.size) {
  console.log("\nProgram labels not found, and the programs on this database with the same number:");
  for (const label of [...unknownLabels].sort()) {
    const digits = /\d{3,}/.exec(str(label))?.[0] ?? "";
    const near = digits ? programs.filter((p) => `${p.code} ${p.name}`.replace(/\D/g, " ").split(" ").includes(digits)) : [];
    console.log(`  "${label}" → ${near.length ? near.map((p) => `${p.id} code "${p.code}" name "${p.name}"`).join("; ") : "none"}`);
  }
}
console.log(`\nNot yet in the database (would be written): ${newCounts.members} members, ${newCounts.accounts} accounts, ${newCounts.sales} New Sales, ${newCounts.payments} collections (${newCounts.paymentsOnExistingAccounts} of them on accounts already in the database).`);
if (heldNew.length) {
  console.log(`New collections held back because they do not fit the account's history in the database (${heldNew.length}):`);
  for (const line of heldNew.slice(0, 40)) console.log(`  ${line}`);
  writeFileSync(`backups/legacy-held-new-${stamp}.txt`, heldNew.join("\n"));
}
if (!apply) {
  const orRepeats = valid.reduce((count, e) => count + e.payments.filter((pay) => !existingIds.has(pay.id) && usedOr.has(entryKey(pay.orNumber))).length, 0);
  console.log(`\n${orRepeats} payment(s) reuse an OR number already in the database and would be imported flagged as duplicates.`);
  console.log("Dry run only. Nothing was written to Members, Member programs, Sales, Beneficiaries, or Collections.");
  process.exit(0);
}
if (invalid.length && !skipInvalid) { console.error(`\n${invalid.length} account(s) fail review. Fix them in the old workbook, or re-run with --skip-invalid to import only passing accounts.`); process.exit(1); }

/* ---------- write ---------- */
const importedAt = new Date().toISOString();
const identity = ["", "", "Legacy import", importedAt];
const memberNumberFor = (member) => {
  if (existingMemberNumbers.has(member.id)) return existingMemberNumbers.get(member.id);
  // Deterministic PH-######## from the member ID, probing past any number already in use.
  let n = parseInt(createHash("sha1").update(member.id).digest("hex").slice(0, 12), 16) % 100_000_000;
  while (usedMemberNumbers.has(`PH-${String(n).padStart(8, "0")}`)) n = (n + 1) % 100_000_000;
  const number = `PH-${String(n).padStart(8, "0")}`;
  usedMemberNumbers.add(number);
  existingMemberNumbers.set(member.id, number);
  return number;
};
const out = { Members: [], "Member programs": [], Sales: [], Beneficiaries: [], Collections: [] };
const writtenMembers = new Set();
for (const e of valid) {
  // A redirected account (moved or merged since) keeps its own member and PH number.
  const m = e.redirect ? { ...e.member, id: e.redirect.memberId } : e.member, s = e.sale, number = e.redirect ? e.redirect.number : memberNumberFor(m);
  if (!e.redirect && !existingIds.has(m.id) && !writtenMembers.has(m.id)) {
    writtenMembers.add(m.id);
    const p = m.parsed, f = m.first;
    // The old tabs have no member contact: the claimant's number is used (owner's decision 2026-10-06).
    out.Members.push([m.id, number, p.surname, p.firstName, p.middleName, p.nameExtension, m.birthdate, "", "", f?.age ?? "", titleCase(f?.civil), f?.claimantContact ?? "", f?.address ?? "", f?.claimantName ?? "", f?.claimantContact ?? "", "No", "", "Active", ...identity]);
  }
  const created = parseTimestamp(s?.timestamp ?? e.payments[0]?.row.timestamp) || importedAt;
  if (!existingIds.has(e.id)) out["Member programs"].push([e.id, m.id, number, e.program.id, e.doi, e.branch.name, e.mas, "Cash", s ? yesNo(s.regFee) : "", s?.regAmount ?? "", s ? parseAmount(s.amount) || 0 : "", "", "Active", created, ...identity, e.status]);
  if (s) {
    const saleId = hashId("SALE", s.ref);
    if (!existingIds.has(saleId)) {
      const p = parseName(s.member);
      out.Sales.push([saleId, created, s.branch$.name, s.agent$?.name ?? s.agent, parseDate(s.dateRemitted).date, number, p.surname, p.firstName, p.middleName, p.nameExtension, s.birth, "", "", s.age, titleCase(s.civil), s.claimantContact, s.address, s.claimantName, s.claimantContact, "No", "", e.program.id, s.doi, "Cash", yesNo(s.regFee), s.regAmount, parseAmount(s.amount) || 0, "", s.applicationNo, s.orNumber, s.doi, ...identity, "Remitted", "", s.agent$?.id ?? "", "", "", "", "", ""]);
      s.beneficiaries.forEach((b, i) => { const p = parseName(b.name); out.Beneficiaries.push([hashId("BEN", s.ref, i), m.id, saleId, p.surname, p.firstName, p.middleName, "", Number(b.age) || 0, titleCase(b.relationship), ...identity]); });
    }
  }
  for (const pay of e.payments) {
    if (existingIds.has(pay.id)) continue;
    const r = pay.row;
    out.Collections.push([pay.id, hashId("CBT", r.territory, norm(r.branch), norm(r.agent), pay.dateRemitted), e.id, m.id, number, e.program.id, findBranch(r.branch)?.name ?? r.branch, pay.mas,
      pay.orNumber, pay.orDate, pay.amount, pay.monthFrom, pay.monthTo, pay.nopFrom, pay.nopTo, yesNo(r.reactivation), yesNo(r.transferred), r.suspended, r.originalMas, "Posted", parseTimestamp(r.timestamp) || importedAt,
      ...identity, pay.channel, "", "", "Remitted", "", pay.agent?.id ?? "", pay.mas, pay.channel === "Collector" ? "Collector" : "MAS", "Cash", "", "", "", ""]);
  }
}
console.log(`\nWriting: ${Object.entries(out).map(([t, rows]) => `${rows.length} ${t}`).join(", ")}.`);
const meta = await sheets.spreadsheets.get({ spreadsheetId: DB, fields: "sheets.properties" }, options);
writeFileSync(`backups/legacy-migration-ids-${stamp}.json`, JSON.stringify(Object.fromEntries(Object.entries(out).map(([t, rows]) => [t, rows.map((r) => r[0])])), null, 1));
// Order matters for a partial failure: members before the rows that point at them. A re-run skips rows already written.
const flags = { Sales: duplicateFlags(out.Sales, 28, usedApplications), Collections: duplicateFlags(out.Collections, 8, usedOr) };
for (const title of ["Members", "Member programs", "Sales", "Beneficiaries", "Collections"]) {
  for (let i = 0; i < out[title].length; i += 2000) {
    await appendSheetRows(title, out[title].slice(i, i + 2000), flags[title]?.slice(i, i + 2000) ?? []);
  }
  const flagged = flags[title]?.filter((flag) => flag.legacy_duplicate).length ?? 0;
  console.log(`  ${title}: ${out[title].length} row(s) written${flagged ? ` (${flagged} flagged as a duplicate receipt or application number)` : ""}.`);
}
console.log(`Done. Written row IDs are listed in backups/legacy-migration-ids-${stamp}.json (all contain "-LEG-").`);

// What --repair changed on the imported accounts, for staff to review (row references and values only).
const importedRefs = new Set(valid.flatMap((e) => [e.sale?.ref, ...e.rows.map((row) => row.ref)].filter(Boolean)));
const repairRows = repairs.filter((item) => importedRefs.has(item.ref)).map((item) => [hashId("REP", item.ref, item.change), item.where, hashId("COL", item.ref), item.change, item.before, item.after, importedAt]);
if (repairRows.length) {
  const title = "Legacy Repairs";
  if (!meta.data.sheets.some((sheet) => sheet.properties.title === title)) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: DB, requestBody: { requests: [{ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } }] } }, options);
    await sheets.spreadsheets.values.update({ spreadsheetId: DB, range: `'${title}'!A1:G1`, valueInputOption: "RAW", requestBody: { values: [["repair_id", "source_row", "collection_id", "change", "before", "after", "repaired_at"]] } }, options);
  }
  await sheets.spreadsheets.values.append({ spreadsheetId: DB, range: `'${title}'!A:G`, valueInputOption: "RAW", insertDataOption: "INSERT_ROWS", requestBody: { values: repairRows } }, options);
  console.log(`  Legacy Repairs: ${repairRows.length} change(s) listed.`);
}

// Imported rows leave the Legacy Pending tabs (matched by their original source tab and row).
if (fromPending && importedRefs.size) {
  const removed = await removePendingRows(importedRefs, false);
  console.log(`  Removed ${removed.ns} New Sales and ${removed.coll} Collections row(s) from the Legacy Pending tabs.`);
}

/** Deletes the Legacy Pending rows whose original source, tab and row are in `refs` (or only counts them). */
async function removePendingRows(refs, countOnly) {
  const fresh = await sheets.spreadsheets.get({ spreadsheetId: DB, fields: "sheets.properties" }, options);
  const targets = [];
  for (const suffix of ["NS", "COLL"]) {
    const title = `${PENDING_PREFIX} ${suffix}`;
    const properties = fresh.data.sheets.find((sheet) => sheet.properties.title === title)?.properties;
    if (!properties) continue;
    const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: DB, range: `'${title}'!A:C` }, options)).data.values ?? [];
    rows.forEach((row, index) => { if (index > 0 && refs.has(`${str(row[0])}|${str(row[1])}|${Number(row[2])}`)) targets.push({ index, sheetId: properties.sheetId, suffix }); });
  }
  targets.sort((a, b) => a.sheetId - b.sheetId || b.index - a.index);
  if (!countOnly && targets.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: DB, requestBody: { requests: targets.map((item) => ({ deleteDimension: { range: { sheetId: item.sheetId, dimension: "ROWS", startIndex: item.index, endIndex: item.index + 1 } } })) } }, options);
  return { ns: targets.filter((item) => item.suffix === "NS").length, coll: targets.filter((item) => item.suffix === "COLL").length };
}

/* ---------- --export-pending: keep every row the database does not have ---------- */
async function writePendingTabs() {
  if (fromPending) throw new Error("--export-pending reads the original workbook, not the Legacy Pending tabs.");
  // Each row's reasons: the issues logged for it, plus its account's review result.
  const reasons = new Map();
  const add = (where, reason) => { if (!reasons.has(where)) reasons.set(where, new Set()); reasons.get(where).add(reason); };
  for (const [category, wheres] of issues) for (const where of wheres) add(where, category);
  for (const e of enrollments) {
    for (const row of e.rows) row.memberId = e.member.id;
    if (e.invalid) for (const row of [e.sale, ...e.rows].filter(Boolean)) add(row.where, `Account fails review: ${e.invalid}`);
  }
  const tabs = [
    { title: `${PENDING_PREFIX} NS`, rows: saleRows.filter((r) => !existingIds.has(hashId("SALE", r.ref))) },
    { title: `${PENDING_PREFIX} COLL`, rows: collectionRows.filter((r) => !existingIds.has(hashId("COL", r.ref))) },
  ];
  const meta = await sheets.spreadsheets.get({ spreadsheetId: DB, fields: "sheets.properties" }, options);
  const taken = tabs.filter((t) => meta.data.sheets.some((s) => s.properties.title === t.title));
  if (taken.length) throw new Error(`${taken.map((t) => t.title).join(" and ")} already exist in the database. Rename or delete before exporting again (staff edits there would be overwritten).`);
  const cellValue = (v) => {
    if (v instanceof Date) return v.getUTCHours() || v.getUTCMinutes() ? v.toISOString().slice(0, 19).replace("T", " ") : v.toISOString().slice(0, 10);
    return v ?? "";
  };
  // Repeated header names (NAME, AGE, RELATIONSHIP) are told apart by occurrence; blank headers are dropped.
  const slots = (headers) => { const seen = new Map(); return headers.map((h) => { const k = headerKey(h); if (!k) return null; const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return { key: `${k}#${n}`, label: str(h) }; }); };
  for (const tab of tabs) {
    // One header for every source tab of this kind: original columns in first-seen order.
    const standard = [], position = new Map();
    for (const row of tab.rows) for (const slot of slots(row.headers)) if (slot && !position.has(slot.key)) { position.set(slot.key, standard.length); standard.push(slot.label); }
    const values = [["SOURCE", "SOURCE TAB", "SOURCE ROW", "REASON NOT MIGRATED", "LEGACY MEMBER ID", ...standard]];
    for (const row of tab.rows) {
      const [sourceTitle, sourceTab, sourceRow] = row.ref.split("|");
      const cells = Array(standard.length).fill("");
      slots(row.headers).forEach((slot, i) => { if (slot) cells[position.get(slot.key)] = cellValue(row.raw[i]); });
      values.push([sourceTitle, sourceTab, Number(sourceRow), [...(reasons.get(row.where) ?? ["Not migrated"])].join("; "), row.memberId ?? "", ...cells]);
    }
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: DB, requestBody: { requests: [{ addSheet: { properties: { title: tab.title, gridProperties: { rowCount: values.length + 100, columnCount: values[0].length, frozenRowCount: 1 } } } }] } }, options);
    for (let i = 0; i < values.length; i += 2000) {
      await sheets.spreadsheets.values.update({ spreadsheetId: DB, range: `'${tab.title}'!A${i + 1}`, valueInputOption: "RAW", requestBody: { values: values.slice(i, i + 2000) } }, options);
    }
    console.log(`Exported ${values.length - 1} row(s) to the "${tab.title}" tab.`);
  }
}
// Close the database connections.
process.exit(0);

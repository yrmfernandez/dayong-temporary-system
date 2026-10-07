/**
 * How much of the old web app's export (scripts/legacy-site-export.mjs → legacy-data/export/) is already in our
 * database, mostly from the old workbook import (-LEG- IDs). Read-only; prints only counts, branches and date ranges,
 * never a member's details. Writes the unmatched record IDs to legacy-data/export/not-in-database.json for the import.
 *
 *   node scripts/legacy-site-compare.mjs                 # staging (.env.local)
 *   npm run prod -- node scripts/legacy-site-compare.mjs # production
 *
 * Matching: members and New Sales by full name (same words in any order, ignoring punctuation and case); collections by
 * OR number with its branch letter ("12345 A" = "12345a") and OR date. Application numbers are NOT used: each system
 * numbers its own, and 731 coincide for different people in different branches (checked October 6, 2026).
 */
import nextEnv from "@next/env";
import fs from "node:fs";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const DIR = "legacy-data/export";
const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error("Missing DATABASE_URL.");
for (const file of ["members", "new_sales", "collections"]) if (!fs.existsSync(`${DIR}/${file}.csv`)) throw new Error(`Missing ${DIR}/${file}.csv: run scripts/legacy-site-export.mjs first.`);

function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else quoted = false; } else cell += c; }
    else if (c === "\"") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""])));
}

const words = (...parts) => parts.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((word) => word.length > 1 || /\d/.test(word));
const nameKey = (...parts) => [...new Set(words(...parts))].sort().join(" ");
/** OR number with its branch letter, ignoring spaces, case and leading zeros: "012345 a" → "12345A". */
const receipt = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+/, "");
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** "2025-03-04", "03/04/2025", "Mar 4, 2025", "March 4, 2025" → "2025-03-04". */
function isoDate(value) {
  const text = String(value ?? "").trim(); let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text))) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text))) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  if ((m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/.exec(text)) && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return "";
}
const count = (list, key) => Object.entries(list.reduce((all, item) => ({ ...all, [key(item) || "(blank)"]: (all[key(item) || "(blank)"] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]);
const range = (list, key) => { const dates = list.map(key).filter(Boolean).sort(); return dates.length ? `${dates[0]} to ${dates.at(-1)}` : "no dates"; };
const pct = (part, whole) => `${whole ? Math.round((part / whole) * 100) : 0}%`;

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
try {
  const [members, collections] = await Promise.all([
    sql`select first_name, middle_name, surname, name_extension from members`,
    // As text: the driver returns a date column as a Date, which never equals the site's "2026-05-11".
    sql`select or_number, or_date::text as or_date from collections where or_number is not null and or_number <> ''`,
  ]);
  console.log(`Database: ${project} · ${members.length} members, ${collections.length} collections with OR numbers\n`);

  // Full names: exact word set, or the database's first name + surname words all present in the site's name.
  const fullNames = new Set(members.map((m) => nameKey(m.first_name, m.middle_name, m.surname, m.name_extension)));
  const bySurname = new Map();
  for (const m of members) { const core = words(m.first_name, m.surname); for (const word of words(m.surname)) (bySurname.get(word) ?? bySurname.set(word, []).get(word)).push(core); }
  const knownName = (name) => {
    if (fullNames.has(nameKey(name))) return true;
    const site = new Set(words(name));
    return [...site].some((word) => (bySurname.get(word) ?? []).some((core) => core.length >= 2 && core.every((w) => site.has(w))));
  };

  const siteMembers = readCsv(`${DIR}/members.csv`);
  const newMembers = siteMembers.filter((m) => !knownName(m["Full Name"]));
  console.log(`Members: ${siteMembers.length} on the old site · ${siteMembers.length - newMembers.length} already in the database (${pct(siteMembers.length - newMembers.length, siteMembers.length)}) · ${newMembers.length} not found`);
  console.log(`  not found, by branch: ${count(newMembers, (m) => m.Branch).slice(0, 12).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
  console.log(`  not found, added on the old site: ${range(newMembers, (m) => isoDate(m.data_created_at))}`);

  const siteSales = readCsv(`${DIR}/new_sales.csv`);
  const newSales = siteSales.filter((s) => !knownName(s["Full Name"]));
  console.log(`\nNew Sales: ${siteSales.length} on the old site · ${siteSales.length - newSales.length} for a member already in the database · ${newSales.length} member not found`);
  console.log(`  not found, OR dates: ${range(newSales, (s) => isoDate(s["OR Date"]))}`);
  console.log(`  not found, by branch: ${count(newSales, (s) => s.Branch).slice(0, 12).map(([b, n]) => `${b} ${n}`).join(" · ")}`);

  const receipts = new Set(collections.map((c) => `${receipt(c.or_number)}|${isoDate(c.or_date)}`));
  const receiptNumbers = new Set(collections.map((c) => receipt(c.or_number)));
  const siteCollections = readCsv(`${DIR}/collections.csv`);
  const sameReceipt = (c) => receipts.has(`${receipt(c.OR)}|${isoDate(c["OR Date"])}`);
  const newCollections = siteCollections.filter((c) => !sameReceipt(c));
  const numberOnly = newCollections.filter((c) => receiptNumbers.has(receipt(c.OR))).length;
  console.log(`\nCollections: ${siteCollections.length} on the old site · ${siteCollections.length - newCollections.length} match OR number and date · ${numberOnly} share only the OR number (different date) · ${newCollections.length - numberOnly} OR number not in the database`);
  console.log(`  not matched, OR dates: ${range(newCollections, (c) => isoDate(c["OR Date"]))}`);
  console.log(`  not matched, by branch: ${count(newCollections, (c) => c.Branch).slice(0, 12).map(([b, n]) => `${b} ${n}`).join(" · ")}`);
  const unreadable = [...siteSales.map((s) => s["OR Date"]), ...siteCollections.map((c) => c["OR Date"])].filter((d) => d && !isoDate(d)).length;
  if (unreadable) console.log(`\n${unreadable} OR dates in an unexpected format were treated as blank.`);

  fs.writeFileSync(`${DIR}/not-in-database.json`, JSON.stringify({ database: project, members: newMembers.map((m) => m.record_id), new_sales: newSales.map((s) => s.record_id), collections: newCollections.map((c) => c.record_id) }, null, 2));
  console.log(`\nRecord IDs not found: ${DIR}/not-in-database.json`);
} finally {
  await sql.end();
}

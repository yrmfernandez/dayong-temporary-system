/**
 * For staff to check, by hand, the old web app records the import left out (owner, October 10, 2026): writes
 * legacy-data/web-left-out.csv from the latest legacy-data/web-import-report-*.txt and the export in legacy-data/export/
 * with what is needed to look each one up in this system: member name, branch, MAS, program, application or OR number,
 * dates, amount, and why it was left out. Nothing is printed except counts; the file stays on this PC (it holds
 * personal data). Reads files only; no database.
 *
 *   node scripts/web-left-out-sheet.mjs
 */
import fs from "node:fs";

const DIR = "legacy-data/export";
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
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, (values[index] ?? "").trim()])));
}
const csvCell = (value) => { const text = String(value ?? ""); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

const reports = fs.readdirSync("legacy-data").filter((name) => /^web-import-report-.*\.txt$/.test(name)).sort();
if (!reports.length) throw new Error("No legacy-data/web-import-report-*.txt: run scripts/migrate-legacy-site.mjs first.");
const report = `legacy-data/${reports.at(-1)}`;
const lines = fs.readFileSync(report, "utf8").split(/\r?\n/).map((line) => line.split("\t")).filter((parts) => parts.length >= 3 && /^(New Sale|Collection)$/.test(parts[0]));
const sales = new Map(readCsv(`${DIR}/new_sales.csv`).map((row) => [row.record_id, row]));
const collections = new Map(readCsv(`${DIR}/collections.csv`).map((row) => [row.record_id, row]));
// A collection's New Sale (same old member and program), for its application number.
const saleOf = (row) => [...sales.values()].find((sale) => sale.member_id_value === row.member_id_value && sale.program_id_value === row.program_id_value);

const header = ["Type", "Old record ID", "Why left out", "Member", "Branch", "MAS", "Program", "Application no.", "OR number", "OR date", "Date remitted", "Amount", "Months / NOP", "Old site link"];
const out = [header];
for (const [type, id, why] of lines) {
  if (type === "New Sale") {
    const row = sales.get(id) ?? {};
    out.push([type, id, why, row["Full Name"], row.Branch, row.MAS, row.Program, row["App No"] || row.app_no, row["OR #"] || row.or_number, row["OR Date"], row["Date Remitted"] || row.date_remitted, row.amount || row.data_amount, "", `https://dayong.gissolve.com/new-sales/edit/${id}`]);
  } else {
    const row = collections.get(id) ?? {};
    const sale = saleOf(row);
    out.push([type, id, why, row.Member, row.Branch, row.Agent, row.Program, sale?.["App No"] ?? "", row.OR || row.or_number, row["OR Date"], "", row.Amount || row.amount, [row["Month From"], row["Month To"]].filter(Boolean).join(" to ") + (row.NOP ? ` (NOP ${row.NOP})` : ""), `https://dayong.gissolve.com/entries/edit/${id}`]);
  }
}
fs.writeFileSync("legacy-data/web-left-out.csv", `﻿${out.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`);
const count = (type) => lines.filter((line) => line[0] === type).length;
console.log(`From ${report}: ${count("New Sale")} New Sales and ${count("Collection")} collections left out.`);
console.log("Written: legacy-data/web-left-out.csv (open in Excel; it holds member names, keep it on this PC).");

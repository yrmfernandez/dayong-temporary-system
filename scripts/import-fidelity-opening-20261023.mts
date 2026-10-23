/**
 * Fidelity opening balances from the old system (owner, October 23, 2026): the "Fidelity Bond" tab of
 * legacy-data/old-data/Sales + Fidelity Bond Record 2025.xlsx lists each Marketing Account Staff's Fidelity for
 * 2022-2023, 2024, 2025 and 2026 (old system only; this system's own contributions add on top), a TOTAL, Active or
 * Inactive, and what was withdrawn (Y/N, or 50%, with the amount).
 *
 * - Each MAS gets an "Opening Balance (old system)" of their TOTAL (lib/fidelity.ts OPENING_TYPE), dated CUTOVER.
 * - Active with a withdrawal amount: also a "Withdrawal (old system)" of that amount, so the balance is TOTAL minus it.
 * - Only MAS marked Active on the sheet are imported (owner, October 23, 2026); Inactive ones are left out and counted.
 *   An Active MAS marked withdrawn without an amount is held back and listed.
 * - Names are matched to employees: the same surname and a first name that starts the same (or the same initial when
 *   the sheet has only an initial), and only one such employee. Anything else is listed, not guessed. The owner can
 *   settle a name in legacy-data/fidelity-name-map.json: { "<sheet name>": "<employee ID>" }, or null to leave it out.
 * - An employee who already has an opening balance is skipped, so the script can run again after the map is filled.
 *
 * Preview: node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/import-fidelity-opening-20261023.mts
 * Prefix with node scripts/prod.mjs for production; add --apply to write. One transaction; Record Corrections keeps a summary.
 */
import { existsSync, readFileSync } from "node:fs";
import nextEnv from "@next/env";
import ExcelJS from "exceljs";
import { sql } from "drizzle-orm";
import { encodedBy, inTransaction, schema } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";
import { OLD_WITHDRAWAL_TYPE, OPENING_TYPE } from "@/lib/fidelity";
import { createReadableId } from "@/lib/readable-id";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const FILE = process.argv.find((arg) => arg.endsWith(".xlsx")) ?? "legacy-data/old-data/Sales + Fidelity Bond Record 2025.xlsx";
const MAP_FILE = "legacy-data/fidelity-name-map.json";
/** The old system's last day: this system took over on October 1, 2026. */
const CUTOVER = "2026-09-30";
const SHEET_TOTAL = 1041857.13;

const rows = <T,>(result: unknown): T[] => Array.isArray(result) ? result : (result as { rows: T[] }).rows;
const round = (value: number) => Math.round(value * 100) / 100;
const peso = (value: number) => value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cellValue = (value: ExcelJS.CellValue) => value && typeof value === "object" ? ("result" in value ? value.result : "richText" in value ? value.richText.map((part) => part.text).join("") : null) : value;
const num = (value: ExcelJS.CellValue) => { const raw = cellValue(value); const parsed = Number(String(raw ?? "").replace(/,/g, "")); return raw === null || raw === undefined || raw === "" ? 0 : Number.isFinite(parsed) ? round(parsed) : NaN; };
const text = (value: ExcelJS.CellValue) => String(cellValue(value) ?? "").trim();

/** "Surname, First M." / "Surname First" / "SURNAME" → lowercase surname and first-name words, without accents or dots. */
function nameParts(name: string) {
  const clean = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const [last, first = ""] = clean.includes(",") ? clean.split(",", 2).map((part) => part.trim()) : [clean.split(" ")[0], clean.split(" ").slice(1).join(" ")];
  return { last: last.replace(/\s+/g, " "), first: first.trim() };
}

type SheetRow = { row: number; name: string; total: number; status: string; flag: string; amount: number; note: string };
const warnings: string[] = [];

async function readSheet(): Promise<SheetRow[]> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(FILE);
  const sheet = book.getWorksheet("Fidelity Bond");
  if (!sheet) throw new Error(`${FILE} has no "Fidelity Bond" tab.`);
  const out: SheetRow[] = [];
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const name = text(row.getCell(1).value);
    if (!name || /^subtotal$/i.test(name)) return;
    const years = [2, 3, 4, 5].map((column) => num(row.getCell(column).value));
    const total = num(row.getCell(6).value);
    // A year cell that is not a number (row 44 has "40.5.0") is not in the sheet's TOTAL either: TOTAL governs, listed.
    years.forEach((value, index) => { if (Number.isNaN(value)) warnings.push(`row ${number} ${name}: ${["2022-2023", "2024", "2025", "2026"][index]} is "${text(row.getCell(index + 2).value)}", not a number; the TOTAL leaves it out`); });
    if (Number.isNaN(total) || Math.abs(round(years.filter((value) => !Number.isNaN(value)).reduce((a, b) => a + b, 0)) - total) > 0.005) throw new Error(`Row ${number} (${name}): the years do not add up to TOTAL.`);
    const flagRaw = cellValue(row.getCell(8).value), amountRaw = cellValue(row.getCell(9).value);
    const amount = typeof amountRaw === "number" ? round(amountRaw) : 0;
    out.push({ row: number, name, total, status: text(row.getCell(7).value), flag: typeof flagRaw === "number" ? `${flagRaw * 100}%` : String(flagRaw ?? "").trim().toUpperCase(), amount, note: typeof amountRaw === "string" ? amountRaw.trim() : "" });
  });
  const sum = round(out.reduce((total, item) => total + item.total, 0));
  if (Math.abs(sum - SHEET_TOTAL) > 0.005) throw new Error(`The sheet's totals add up to ${peso(sum)}, not ${peso(SHEET_TOTAL)}.`);
  return out;
}

class PreviewDone extends Error {}

async function main() {
  const sheet = await readSheet();
  const nameMap: Record<string, string | null> = existsSync(MAP_FILE) ? JSON.parse(readFileSync(MAP_FILE, "utf8")) : {};
  await runAsSystem(() => inTransaction(async (tx) => {
    if (apply) await tx.execute(sql`lock table fidelity in share row exclusive mode`);
    const employees = rows<{ id: string; name: string; status: string }>(await tx.execute(sql`select employee_id as id, full_name as name, coalesce(employment_status, '') as status from employees`));
    const opened = new Set(rows<{ id: string }>(await tx.execute(sql`select distinct mas_employee_id as id from fidelity where lower(transaction_type) = lower(${OPENING_TYPE})`)).map((row) => row.id));

    const match = (name: string): { id?: string; why: string } => {
      if (name in nameMap) return nameMap[name] ? { id: nameMap[name]!, why: "name map" } : { why: "left out in the name map" };
      const want = nameParts(name);
      const sameLast = employees.filter((employee) => nameParts(employee.name).last === want.last);
      const firstWord = want.first.split(" ")[0] ?? "";
      const fits = sameLast.filter((employee) => {
        const have = nameParts(employee.name).first;
        if (!firstWord) return false;
        return firstWord.length === 1 ? have.startsWith(firstWord) : have.startsWith(firstWord) || have.split(" ")[0] === firstWord;
      });
      if (fits.length === 1) return { id: fits[0].id, why: firstWord.length === 1 ? "surname and initial" : "surname and first name" };
      if (fits.length > 1) return { why: `several employees fit: ${fits.map((employee) => `${employee.name} (${employee.id})`).join("; ")}` };
      if (!firstWord && sameLast.length) return { why: `surname only; employees with it: ${sameLast.map((employee) => `${employee.name} (${employee.id})`).join("; ")}` };
      return { why: sameLast.length ? `no first-name match among ${sameLast.map((employee) => `${employee.name} (${employee.id})`).join("; ")}` : "no employee with this surname" };
    };

    const imported: Array<{ sheet: SheetRow; id: string; name: string; how: string; withdrawn: number }> = [];
    const held: Array<{ row: number; name: string; status: string; total: string; withdrawn: string; why: string }> = [];
    const unmatched: Array<{ row: number; name: string; status: string; total: string; why: string }> = [];
    const skipped: string[] = [];
    const seen = new Map<string, string>();
    // Inactive MAS are not imported (owner, October 23, 2026).
    const inactive = sheet.filter((item) => item.status.toLowerCase() !== "active");
    for (const item of sheet.filter((row) => row.status.toLowerCase() === "active")) {
      const withdrawn = item.flag && item.flag !== "N";
      if (withdrawn && !(item.amount > 0)) {
        held.push({ row: item.row, name: item.name, status: item.status, total: peso(item.total), withdrawn: `${item.flag}${item.note ? ` ${item.note}` : ""}`, why: "active, withdrawn without an amount" });
        continue;
      }
      if (item.amount > item.total) throw new Error(`Row ${item.row} (${item.name}): withdrawn ${peso(item.amount)} is more than the total ${peso(item.total)}.`);
      if (!(item.total > 0)) { skipped.push(`row ${item.row} ${item.name}: total is zero`); continue; }
      const found = match(item.name);
      if (!found.id) { unmatched.push({ row: item.row, name: item.name, status: item.status, total: peso(item.total), why: found.why }); continue; }
      const employee = employees.find((candidate) => candidate.id === found.id);
      if (!employee) throw new Error(`${MAP_FILE}: ${item.name} → ${found.id} is not an employee.`);
      if (seen.has(employee.id)) throw new Error(`${item.name} and ${seen.get(employee.id)} both match ${employee.name} (${employee.id}); settle them in ${MAP_FILE}.`);
      seen.set(employee.id, item.name);
      if (opened.has(employee.id)) { skipped.push(`row ${item.row} ${item.name}: ${employee.id} already has an opening balance`); continue; }
      imported.push({ sheet: item, id: employee.id, name: employee.name, how: found.why, withdrawn: item.amount });
    }

    console.log(`Sheet: ${sheet.length} MAS, total ${peso(SHEET_TOTAL)}.${warnings.length ? `\nSheet warnings:\n  ${warnings.join("\n  ")}` : ""}\n`);
    console.log(`To import (${imported.length}):`);
    console.table(imported.map((item) => ({ row: item.sheet.row, sheet: item.sheet.name, employee: `${item.name} (${item.id})`, match: item.how, status: item.sheet.status, total: peso(item.sheet.total), withdrawn: item.withdrawn ? peso(item.withdrawn) : "", balance: peso(item.sheet.total - item.withdrawn) })));
    if (held.length) { console.log(`\nHeld back for the owner (${held.length}):`); console.table(held); }
    if (unmatched.length) { console.log(`\nNot matched to an employee (${unmatched.length}); settle in ${MAP_FILE}:`); console.table(unmatched); }
    if (skipped.length) console.log(`\nSkipped:\n  ${skipped.join("\n  ")}`);
    const openingTotal = round(imported.reduce((total, item) => total + item.sheet.total, 0));
    const withdrawnTotal = round(imported.reduce((total, item) => total + item.withdrawn, 0));
    console.log(`\n${apply ? "Importing" : "Would import"} ${imported.length} opening balances (${peso(openingTotal)}) and ${imported.filter((item) => item.withdrawn).length} old-system withdrawals (${peso(withdrawnTotal)}): balances ${peso(openingTotal - withdrawnTotal)}.`);
    console.log(`Inactive left out ${inactive.length} (${peso(inactive.reduce((total, item) => total + item.total, 0))}). Held back ${held.length}, not matched ${unmatched.length}, skipped ${skipped.length}.`);
    if (!apply) throw new PreviewDone();

    for (const item of imported) {
      const note = `Old system Fidelity Bond sheet row ${item.sheet.row} (${item.sheet.name}): 2022-2026 total ${peso(item.sheet.total)}, ${item.sheet.status}.`;
      await tx.insert(schema.fidelity).values({ fidelity_id: createReadableId("FOB"), mas_employee_id: item.id, mas_name: item.name, transaction_type: OPENING_TYPE, incentive_amount: 0, fidelity_amount: item.sheet.total, transaction_date: CUTOVER, status: "Approved", notes: note, ...encodedBy() });
      if (item.withdrawn) await tx.insert(schema.fidelity).values({ fidelity_id: createReadableId("FOW"), mas_employee_id: item.id, mas_name: item.name, transaction_type: OLD_WITHDRAWAL_TYPE, incentive_amount: 0, fidelity_amount: item.withdrawn, transaction_date: CUTOVER, status: "Released", notes: `Withdrawn in the old system (${item.sheet.flag}), sheet row ${item.sheet.row}.`, ...encodedBy() });
    }
    await tx.insert(schema.record_corrections).values({
      correction_id: createReadableId("COR"), module: "Fidelity opening balances", record_id: "fidelity",
      reason: "Owner, October 23, 2026: Fidelity balances brought from the old system's Fidelity Bond sheet (2022-2026, old system only), Active MAS only; their withdrawals there are subtracted. Inactive MAS are not imported.",
      before_json: { file: FILE, sheetTotal: SHEET_TOTAL, inactiveLeftOut: inactive.length, held: held.map((item) => item.name), unmatched: unmatched.map((item) => item.name) },
      after_json: { imported: imported.map((item) => ({ employee: item.id, sheetRow: item.sheet.row, total: item.sheet.total, withdrawn: item.withdrawn })), openingTotal, withdrawnTotal },
      corrected_at: new Date().toISOString(), ...encodedBy(),
    });
  }));
}
main().then(() => process.exit(0)).catch((error) => {
  if (error instanceof PreviewDone) { console.log("\nPreview only: nothing was saved. Add --apply to write."); process.exit(0); }
  console.error(error instanceof Error ? error.message : String(error)); process.exit(1);
});

/**
 * MAS Report rows (owner, November 16, 2026), in the layout of the paper "Monthly report format for officers and team
 * heads": one row per Marketing Account Staff of the branch, with New Sales and Collections each as Accts, Gross, Inc.
 * and Net (Gross less Inc.), and the totals.
 *
 * Every MAS assigned to the branch is listed, even with nothing in the period (their cells stay empty, as on paper), and
 * anyone else with entries in the branch (a MAS from another branch, DTO) gets a row too, so the totals match the
 * branch's entries. Entries are matched to a MAS by name, ignoring spaces and capitals.
 *
 * No runtime imports, so scripts/test-access-control.mjs loads it directly; lib/mas-report.ts reads the data.
 */

export type MasLine = { accounts: number; gross: number; incentives: number; net: number };
export type MasRow = { name: string; employeeId: string; assigned: boolean; sales: MasLine; collections: MasLine };
export type MasEntry = { kind: "New Sale" | "Collection"; person: string; amount: number; incentive: number };

const round = (value: number) => Math.round(value * 100) / 100;
const key = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
export const emptyLine = (): MasLine => ({ accounts: 0, gross: 0, incentives: 0, net: 0 });

function add(line: MasLine, entry: Pick<MasEntry, "amount" | "incentive">) {
  line.accounts += 1;
  line.gross = round(line.gross + entry.amount);
  line.incentives = round(line.incentives + entry.incentive);
  line.net = round(line.gross - line.incentives);
}

function sum(lines: MasLine[]) {
  const total = emptyLine();
  for (const line of lines) {
    total.accounts += line.accounts;
    total.gross = round(total.gross + line.gross);
    total.incentives = round(total.incentives + line.incentives);
  }
  total.net = round(total.gross - total.incentives);
  return total;
}

export function masReportRows(entries: MasEntry[], staff: Array<{ employeeId: string; name: string }>) {
  const rows = new Map<string, MasRow>();
  for (const person of staff) {
    if (!rows.has(key(person.name))) rows.set(key(person.name), { name: person.name, employeeId: person.employeeId, assigned: true, sales: emptyLine(), collections: emptyLine() });
  }
  for (const entry of entries) {
    const name = entry.person.trim() || "(no MAS)";
    const row = rows.get(key(name)) ?? { name, employeeId: "", assigned: false, sales: emptyLine(), collections: emptyLine() };
    add(entry.kind === "New Sale" ? row.sales : row.collections, entry);
    rows.set(key(name), row);
  }
  // The branch's MAS by name, then anyone else with entries there.
  const list = [...rows.values()].sort((a, b) => Number(b.assigned) - Number(a.assigned) || a.name.localeCompare(b.name));
  return { rows: list, total: { sales: sum(list.map((row) => row.sales)), collections: sum(list.map((row) => row.collections)) } };
}

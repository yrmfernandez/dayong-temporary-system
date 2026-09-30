import { getEmployees } from "@/lib/employees";
import { getCommissions } from "@/lib/finance-operations";
import { buildOperationalReport, type ReportLine } from "@/lib/reports";

const round = (value: number) => Math.round(value * 100) / 100;
const isMas = (roles: string) => roles.split(",").some((role) => role.trim().toLowerCase() === "mas");

/**
 * Commission each person actually earned in a period: the incentives they kept on New Sales and Collections, less the
 * MAS Fidelity deducted in their approved remittances. Any employee with sales earns incentives; only people who
 * earned something are listed, MAS first.
 * `recorded` is what the Commissions register already holds for them in an overlapping period.
 */
export async function getEarnedCommissions(from: string, to: string) {
  const [report, employees, records] = await Promise.all([buildOperationalReport(from, to), getEmployees(), getCommissions()]);
  const people = new Map<string, { person: string; role: string; saleIncentives: number; collectionIncentives: number; fidelity: number; sales: number; collections: number }>();
  const add = (line: ReportLine, kind: "sale" | "collection") => {
    if (!line.person) return;
    const entry = people.get(line.person) ?? { person: line.person, role: line.role || "MAS", saleIncentives: 0, collectionIncentives: 0, fidelity: 0, sales: 0, collections: 0 };
    if (kind === "sale") { entry.saleIncentives += line.incentives; entry.sales += line.accounts; }
    else { entry.collectionIncentives += line.incentives; entry.collections += line.accounts; if (line.role.toLowerCase() === "collector" && entry.role !== "MAS") entry.role = "Collector"; }
    entry.fidelity += line.fidelity;
    people.set(line.person, entry);
  };
  report.sales.forEach((line) => add(line, "sale"));
  report.collections.forEach((line) => add(line, "collection"));
  const byName = new Map(employees.map((employee) => [employee.name.trim().toLowerCase(), employee]));
  return [...people.values()].map((entry) => {
    const employee = byName.get(entry.person.trim().toLowerCase());
    const grossIncentive = round(entry.saleIncentives + entry.collectionIncentives), fidelity = round(entry.fidelity);
    const recorded = employee ? round(records.filter((record) => record.employeeId === employee.id && record.periodFrom <= to && from <= record.periodTo).reduce((sum, record) => sum + record.grossIncentive, 0)) : 0;
    // Any employee with sales earns incentives, so show their actual roles rather than assuming MAS.
    return { employeeId: employee?.id ?? "", name: employee?.name ?? entry.person, role: employee?.roles.length ? employee.roles.join(", ") : entry.role, saleIncentives: round(entry.saleIncentives), collectionIncentives: round(entry.collectionIncentives), sales: entry.sales, collections: entry.collections, grossIncentive, fidelity, netCommission: round(grossIncentive - fidelity), recorded };
  }).filter((entry) => entry.grossIncentive > 0)
    .sort((a, b) => Number(isMas(b.role)) - Number(isMas(a.role)) || b.netCommission - a.netCommission);
}
export type EarnedCommission = Awaited<ReturnType<typeof getEarnedCommissions>>[number];

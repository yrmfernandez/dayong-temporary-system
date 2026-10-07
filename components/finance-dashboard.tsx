import Link from "next/link";
import { AlertTriangle, Clock3, FileText, HandCoins, Landmark, Receipt, Wallet } from "lucide-react";
import { MetricTile } from "@/components/metric-tile";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ExecutiveAnalytics } from "@/lib/executive-analytics";
import type { getRemittanceDashboard } from "@/lib/remittance-workflow";
import type { getCommissions, getVendorPayables } from "@/lib/finance-operations";
import { GrossSalesDrilldown } from "@/components/gross-sales-drilldown";

const money = (value: number) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(value);
type Props = { employeeName: string; today: string; analytics: ExecutiveAnalytics; remittance: Awaited<ReturnType<typeof getRemittanceDashboard>>; payables: Awaited<ReturnType<typeof getVendorPayables>>; commissions: Awaited<ReturnType<typeof getCommissions>> };

/** Finance: cash position, what is owed to and by the company, and the approvals waiting on Finance. */
export function FinanceDashboard({ employeeName, today, analytics, remittance, payables, commissions }: Props) {
  const f = analytics.finance, c = analytics.cash, r = remittance.summary;
  const open = payables.filter((bill) => bill.balance > 0 && !/void|cancel/i.test(bill.status));
  const overdue = open.filter((bill) => bill.dueDate && bill.dueDate < today);
  const pendingCommissions = commissions.filter((item) => item.status === "Pending");
  const actionable = remittance.remittances.filter((row) => ["Pending Approval", "Discrepancy"].includes(row.status));
  return <section className="space-y-6">
    <div><p className="text-sm font-medium text-primary">Finance workspace</p><h1 className="text-2xl font-bold">Cash & Accountability</h1><p className="text-sm text-muted-foreground">Welcome, {employeeName}. Cash position, approvals waiting on you, and what the company owes this month.</p></div>

    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricTile label="Cash on Hand" value={money(c.onHand)} detail={`Burn ${money(c.monthlyOutflow)}/month`} icon={Wallet} tone="teal" href="/cash-transactions" />
      <MetricTile label="Remittances to Approve" value={r.pendingCount} detail={`${money(r.pendingAmount)} expected`} icon={Clock3} tone={r.pendingCount ? "warning" : "success"} href="/remittances" />
      <MetricTile label="Cash Still With Staff" value={money(r.outstandingAmount)} detail={`${r.outstandingCount} collections not yet remitted`} icon={HandCoins} tone={r.outstandingAmount ? "orange" : "success"} href="/remittances" />
      <MetricTile label="Remittance Discrepancies" value={money(r.discrepancyAmount)} detail="Awaiting reconciliation" icon={AlertTriangle} tone={r.discrepancyAmount ? "danger" : "success"} href="/remittances" />
      <GrossSalesDrilldown label="Gross Sales (MTD)" value={f.grossSales} note={`Net ${money(f.netSales)} after commissions`} from={analytics.from} to={analytics.to} />
      <MetricTile label="Expenses (MTD)" value={money(f.expenses)} detail={`Payroll ${money(f.payroll)} · bills ${money(f.vendorBills)}`} icon={Receipt} tone="orange" href="/expenses" />
      <MetricTile label="Unpaid Vendor Bills" value={money(open.reduce((sum, bill) => sum + bill.balance, 0))} detail={overdue.length ? `${overdue.length} overdue` : `${open.length} open`} icon={FileText} tone={overdue.length ? "danger" : "info"} href="/vendor-payables" />
      <MetricTile label="Pending Commissions" value={money(pendingCommissions.reduce((sum, item) => sum + item.netCommission, 0))} detail={`${pendingCommissions.length} records for payroll`} icon={Landmark} tone="info" href="/commissions" />
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Remittances Requiring Action" description="Slips waiting for approval, or where the cash received differs from what was expected." action={<Link href="/remittances" className="text-sm font-medium text-primary hover:underline">Open Remittances</Link>}>
        <Table headers={["Person", "Branch", "Expected", "Actual", "Difference", "Status"]} rows={actionable.slice(0, 8).map((row) => [row.accountableName, row.branch, money(row.expectedAmount), money(row.actualAmount), money(row.difference), <StatusBadge key="s" status={row.status} />])} empty="Nothing waiting for approval." />
      </Panel>
      <Panel title="Month to Date" description="Income and costs from the 1st of this month to today.">
        <Rows rows={[["Gross Sales", money(f.grossSales)], ["Agent commissions", `– ${money(f.commissions)}`], ["Net Sales", money(f.netSales), true], ["Payroll", `– ${money(f.payroll)}`], ["Expenses", `– ${money(f.expenses)}`], ["Vendor bills", `– ${money(f.vendorBills)}`], ["Operating profit", money(f.ebitda), true], ["Expected / actual remittance", `${money(f.expectedRemittance)} / ${money(f.actualRemittance)}`], ["Remittance gap", money(f.gap), true]]} />
      </Panel>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Cash With Staff" description="Collections and New Sales not yet remitted, by the person holding the cash, largest first." action={<Link href="/remittances" className="text-sm font-medium text-primary hover:underline">Collect</Link>}>
        <Table headers={["Person", "Role", "Branch", "Collections", "Amount due"]} rows={[...remittance.accountability].sort((a, b) => b.outstandingAmount - a.outstandingAmount).slice(0, 8).map((row) => [row.name, row.role, row.branch, String(row.collectionCount), money(row.outstandingAmount)])} empty="All collected cash has been remitted." />
      </Panel>
      <Panel title="Vendor Bills Due" description="Unpaid supplier bills, earliest due date first." action={<Link href="/vendor-payables" className="text-sm font-medium text-primary hover:underline">Open Payables</Link>}>
        <Table headers={["Vendor", "Due", "Balance", "Status"]} rows={[...open].sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")).slice(0, 8).map((bill) => [bill.vendor, bill.dueDate || "—", money(bill.balance), <StatusBadge key="s" status={bill.dueDate && bill.dueDate < today ? "Overdue" : bill.status} />])} empty="No unpaid bills." />
      </Panel>
    </div>
  </section>;
}

function Panel({ title, description, action, children }: { title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) { return <Card><CardHeader className="flex flex-row items-start justify-between gap-3"><div className="space-y-1"><CardTitle>{title}</CardTitle><p className="text-sm text-muted-foreground">{description}</p></div>{action}</CardHeader><CardContent>{children}</CardContent></Card>; }
function Rows({ rows }: { rows: Array<[string, string, boolean?]> }) { return <dl className="space-y-2 text-sm">{rows.map(([label, value, strong]) => <div key={label} className="flex justify-between gap-4"><dt className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</dt><dd className={`tabular-nums ${strong ? "font-bold" : "font-medium"}`}>{value}</dd></div>)}</dl>; }
function Table({ headers, rows, empty }: { headers: string[]; rows: React.ReactNode[][]; empty: string }) { return <div className="overflow-x-auto"><table className="w-full min-w-[520px] text-left text-sm"><thead><tr className="border-b">{headers.map((header) => <th key={header} className="pb-3 pr-4 font-medium text-muted-foreground">{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-b last:border-0">{row.map((cell, i) => <td key={i} className="py-2.5 pr-4">{cell || "—"}</td>)}</tr>)}{!rows.length && <tr><td colSpan={headers.length} className="py-8 text-center text-muted-foreground">{empty}</td></tr>}</tbody></table></div>; }

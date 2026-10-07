import { executiveRoles, isAdministratorRole, normalizeRoleName } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { filterGrossSales, getGrossSalesEntries } from "@/lib/gross-sales";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const csvCell = (value: string | number) => { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };

/**
 * The entries behind Gross Sales on the executive and finance dashboards: ?from=&to= (dates), optional q (search),
 * kind ("New Sale" | "Collection"), branch, offset; format=csv downloads every matching entry. Filtering and paging
 * happen here, so a year of entries never travels to the browser at once.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  // The roles whose dashboards show Gross Sales.
  const allowed = (user.roleNames ?? []).some((role) => isAdministratorRole(role) || executiveRoles.includes(normalizeRoleName(role)) || normalizeRoleName(role) === "finance");
  if (!allowed) return Response.json({ success: false, message: "Only Administrators, the CEO, the President and Finance can see the Gross Sales breakdown." }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "", to = params.get("to") ?? "";
  if (!validDate(from) || !validDate(to) || from > to) return Response.json({ success: false, message: "Choose a valid date range." }, { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 400) return Response.json({ success: false, message: "Choose at most 13 months." }, { status: 400 });
  try {
    const breakdown = await getGrossSalesEntries(from, to);
    const filters = { q: params.get("q") ?? "", kind: params.get("kind") ?? "", branch: params.get("branch") ?? "" };
    const matching = filterGrossSales(breakdown.entries, filters);
    if (params.get("format") === "csv") {
      const lines = [["Date", "Type", "Reference", "Member number", "Member", "Program", "Branch", "MAS / accountable", "Amount", "Of which penalty", "Record ID"],
        ...matching.map((row) => [row.date, row.kind, row.reference, row.memberNumber, row.memberName, row.program, row.branch, row.person, row.amount.toFixed(2), row.penalty ? row.penalty.toFixed(2) : "", row.id])];
      return new Response(`\uFEFF${lines.map((line) => line.map(csvCell).join(",")).join("\r\n")}\r\n`, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="gross-sales-${from}-to-${to}.csv"`, "Cache-Control": "private, no-store" },
      });
    }
    const offset = Math.max(0, Number(params.get("offset")) || 0), limit = 200;
    const filteredTotal = Math.round(matching.reduce((sum, row) => sum + row.amount * 100, 0)) / 100;
    return Response.json({ success: true, from, to, totals: breakdown.totals, branches: breakdown.branches, filtered: { count: matching.length, total: filteredTotal }, entries: matching.slice(offset, offset + limit), offset, limit }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Gross sales breakdown error:", error);
    return Response.json({ success: false, message: "Unable to load the Gross Sales breakdown." }, { status: 500 });
  }
}

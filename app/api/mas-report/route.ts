import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { COMPANY } from "@/lib/clerk-report";
import { buildMasReport, reportBranches } from "@/lib/mas-report";
import { validDate } from "@/lib/manila-date";

/**
 * MAS Report (owner, November 16, 2026): each MAS's New Sales and Collections in one branch for a period
 * (lib/mas-report.ts). A MAS-Officer may choose only the branches where they are officer.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canAccessPath(user, "/mas-report")) return Response.json({ success: false, message: "The MAS Report is for MAS-Officers." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const from = params.get("from")?.trim() ?? "", to = params.get("to")?.trim() ?? "";
    if (!validDate(from) || !validDate(to) || from > to) throw new Error("Choose a valid date range.");
    if ((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 > 366) throw new Error("The MAS Report covers at most a year at a time.");
    const branches = await reportBranches(user);
    if (!branches.length) return Response.json({ success: true, branches, officer: user.name, company: COMPANY, report: null, message: "You are not officer of any branch yet. Ask HR to tick Officer for your branch in Employees." }, { headers: { "Cache-Control": "private, no-store" } });
    const asked = params.get("branch")?.trim() ?? "";
    const branch = asked ? branches.find((name) => name.toLowerCase() === asked.toLowerCase()) : branches[0];
    if (!branch) throw new Error("You can see the MAS Report only for the branches where you are officer.");
    const report = await buildMasReport({ from, to, branch });
    return Response.json({ success: true, branches, officer: user.name, company: COMPANY, report }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the MAS Report." }, { status: 400 });
  }
}

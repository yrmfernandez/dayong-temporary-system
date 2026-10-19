import { refuseOnDayOff } from "@/lib/day-off";
import { canAccessPath, canCorrectEntriesFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { correctSaleOrCollection } from "@/lib/entry-corrections";
import { getEditableEntry, saveEntryEdit, type EditKind } from "@/lib/entry-edit";
import { isSearchKind, SEARCH_LIMIT, searchEntries } from "@/lib/entry-search";
import { canDeleteRecords } from "@/lib/admin-delete";
import { getEmployees } from "@/lib/employees";
import { getPrograms } from "@/lib/google-sheets-data";

/** IT and Administrators with the Entry Corrections page (Roles → Page access may take it away). */
async function allowedUser() {
  const user = await getSessionUser();
  return user && canCorrectEntriesFor(user) && canAccessPath(user, "/entry-corrections") ? user : null;
}

/**
 * Edit / Corrections (owner, October 15, 2026): search New Sales and Collections, remitted ones included
 * (lib/entry-search.ts); GET ?kind=&id= loads one entry for a full edit and PUT saves it (lib/entry-edit.ts); PATCH is
 * the quick number correction (lib/entry-corrections.ts). Every change needs a reason (Record Corrections).
 */
const editKind = (value: unknown): EditKind => (value === "New Sale" ? "New Sale" : "Collection");
export async function GET(request: Request) {
  const user = await allowedUser();
  if (!user) return Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    // The pickers of the Move tabs: every employee and program.
    if (params.get("options")) {
      const [employees, programs] = await Promise.all([getEmployees(), getPrograms()]);
      return Response.json({ success: true,
        employees: employees.map((item) => ({ id: item.id, name: item.name, branch: item.branch, roles: item.roles, status: item.status })).sort((a, b) => a.name.localeCompare(b.name)),
        programs: programs.map((item) => ({ id: item.id, name: item.name, code: item.code, rate: Number(item.basePay) || 0, status: item.status })).sort((a, b) => a.name.localeCompare(b.name)) }, { headers: { "Cache-Control": "private, no-store" } });
    }
    if (params.get("id")) return Response.json({ success: true, entry: await getEditableEntry(editKind(params.get("kind")), params.get("id") ?? "") }, { headers: { "Cache-Control": "private, no-store" } });
    const kind = params.get("kind") ?? "all";
    const entries = await searchEntries(params.get("q") ?? "", isSearchKind(kind) ? kind : "all");
    return Response.json({ success: true, entries, limit: SEARCH_LIMIT, canDelete: canDeleteRecords(user) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to search entries." }, { status: 400 });
  }
}

export const PATCH = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await allowedUser())) return Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });
  try {
    return Response.json({ success: true, ...(await correctSaleOrCollection(await request.json())) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct the entry." }, { status: 400 });
  }
});

export const PUT = withEncoder(async (request: Request) => {
  // Day Off locks the day's entries (lib/day-off.ts).
  const dayOff = await refuseOnDayOff();
  if (dayOff) return dayOff;
  if (!(await allowedUser())) return Response.json({ success: false, message: "IT or Administrator access is required." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const number = (key: string) => (body[key] === undefined || body[key] === "" ? undefined : Number(body[key]));
    const string = (key: string) => (typeof body[key] === "string" ? body[key] as string : undefined);
    const message = await saveEntryEdit({
      kind: editKind(body.kind), id: String(body.id ?? ""), reason: String(body.reason ?? ""),
      enrollmentId: string("enrollmentId"), programId: string("programId"), orNumber: string("orNumber"), orDate: string("orDate"), amount: number("amount"), months: number("months"),
      dateRemitted: string("dateRemitted"), applicationNumber: string("applicationNumber"), notes: string("notes"), paymentMethod: string("paymentMethod"), doiTime: string("doiTime"),
    });
    return Response.json({ success: true, message });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the entry." }, { status: 400 });
  }
});

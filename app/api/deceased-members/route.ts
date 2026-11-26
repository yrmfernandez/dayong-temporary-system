import { canAccessPath, canOverseeDeceased } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import {
  addDeceased, DECEASED_CLAIMS, DECEASED_REQUIREMENTS, DECEASED_SERVICES, deceasedBranches, deceasedFormOptions, deceasedMemberChoices,
  listDeceased, setDeceasedRemoved, updateDeceased,
} from "@/lib/deceased-members";
import { withEncoder } from "@/lib/encoder-context";
import { manilaToday } from "@/lib/manila-date";

const noStore = { "Cache-Control": "private, no-store" };
const failure = (error: unknown, fallback: string, status = 400) => Response.json({ success: false, message: error instanceof Error ? error.message : fallback }, { status });
const denied = () => failure(null, "You do not have access to Deceased Members.", 403);

/**
 * Deceased Members (lib/deceased-members.ts).
 * GET ?view=mine|all&removed=1: the signed-in clerk's own records with their branches and the form's choices, or, for
 * Administrators and Finance (canOverseeDeceased), every record (view only).
 * GET ?members=1&branch=&mas=: the members with an account under that branch and MAS, for the member field.
 * POST adds a record. PATCH { action: "update" | "remove" | "restore", id, ... } changes one's own records only.
 * Files: app/api/deceased-members/files/route.ts.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const params = new URL(request.url).searchParams;
    const own = await deceasedBranches(user.employeeId);
    if (params.get("members") === "1") {
      const branch = own.names.find((name) => name.toLowerCase() === (params.get("branch") ?? "").trim().toLowerCase());
      if (!branch) throw new Error("Choose one of your branches.");
      return Response.json({ success: true, members: await deceasedMemberChoices(branch, params.get("mas") ?? "") }, { headers: noStore });
    }
    const canOversee = canOverseeDeceased(user);
    const view = canOversee && params.get("view") !== "mine" ? "all" : "mine";
    const [records, options] = await Promise.all([
      listDeceased({ employeeId: view === "all" ? "" : user.employeeId, includeRemoved: params.get("removed") === "1" }),
      deceasedFormOptions(own.names),
    ]);
    return Response.json({
      success: true, view, canOversee, today: manilaToday(), records,
      branches: own.names, primaryBranch: own.primary, mas: options.mas, programs: options.programs,
      requirements: DECEASED_REQUIREMENTS, claims: DECEASED_CLAIMS, services: DECEASED_SERVICES,
    }, { headers: noStore });
  } catch (error) { return failure(error, "Unable to load Deceased Members.", 500); }
}

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    const own = await deceasedBranches(user.employeeId);
    const record = await addDeceased({ employeeId: user.employeeId, name: own.name || user.name }, body);
    return Response.json({ success: true, record, message: `${record.deceasedName} saved.` });
  } catch (error) { return failure(error, "Unable to save the record."); }
});

export const PATCH = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canAccessPath(user, "/deceased-members")) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = String(body.id ?? "");
    switch (body.action) {
      case "update": {
        const record = await updateDeceased(user.employeeId, id, body);
        return Response.json({ success: true, record, message: `${record.deceasedName} saved.` });
      }
      case "remove": {
        const record = await setDeceasedRemoved(user.employeeId, id, true, String(body.reason ?? ""));
        return Response.json({ success: true, record, message: `${record.deceasedName} removed. Show removed records to restore it.` });
      }
      case "restore": {
        const record = await setDeceasedRemoved(user.employeeId, id, false);
        return Response.json({ success: true, record, message: `${record.deceasedName} is back on the list.` });
      }
      default: throw new Error("Unknown action.");
    }
  } catch (error) { return failure(error, "Unable to save the change."); }
});

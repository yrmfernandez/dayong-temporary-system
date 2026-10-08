import { canAccessPath } from "@/lib/access-control";
import { canDeleteRecords } from "@/lib/admin-delete";
import { ownMembersScope } from "@/lib/member-scope";
import { canManageUsers, userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { deleteMemberRecord, updateMemberRecord } from "@/lib/master-data-crud";
import { queryMemberDirectory } from "@/lib/member-directory-data";
import { emptyDirectoryFilters, type DirectoryFilters } from "@/lib/member-directory";
import { canTransferMembers, getTransferHistory } from "@/lib/member-transfer";

const SORTS = ["name", "number", "status"] as const;

/** One page of the Members directory. Filters, sort and page come from the query string; everything runs on the server. */
export async function GET(request: Request) {
  const user = await userWithPageAccess("/members");
  if (!user) return Response.json({ success: false, message: "You do not have access to Members." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const value = (key: string) => (params.get(key) ?? "").trim();
    const filters: DirectoryFilters = { ...emptyDirectoryFilters, search: value("search"), branch: value("branch"), mas: value("mas"), program: value("program"), status: value("status"), accountStatus: value("accountStatus"), standing: value("standing") };
    const sort = (SORTS as readonly string[]).includes(value("sort")) ? value("sort") as (typeof SORTS)[number] : "name";
    // A MAS sees only members they handle, and only those programs; only those are loaded.
    const scope = await ownMembersScope(user);
    const result = await queryMemberDirectory({ filters, sort, descending: value("order") === "desc", page: Number(value("page")) || 1, pageSize: 25, onlyMas: scope });
    const shown = new Set(result.members.flatMap((member) => member.enrollments.map((enrollment) => enrollment.id)));
    const [canTransfer, transfers] = await Promise.all([canTransferMembers(), getTransferHistory()]);
    return Response.json({ success: true, ...result, canManage: await canManageUsers(), canDelete: canDeleteRecords(user), canTransfer, transfers: transfers.filter((transfer) => shown.has(transfer.enrollmentId)), canAddMember: canAccessPath(user, "/new-sales") }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Member directory error:", error);
    return Response.json({ success: false, message: "Unable to load members. Please retry or check the member records." }, { status: 500 });
  }
}

export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to update members." }, { status: 403 });
  try { const body = await request.json(); const id = typeof body.id === "string" ? body.id.trim() : ""; return Response.json({ success: true, member: await updateMemberRecord(id, { contact: typeof body.contact === "string" ? body.contact : "", status: typeof body.status === "string" ? body.status : "" }) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update member." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to delete members." }, { status: 403 });
  try { const body = await request.json(); const id = typeof body.id === "string" ? body.id.trim() : ""; await deleteMemberRecord(id); return Response.json({ success: true }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete member." }, { status: 400 }); }
});

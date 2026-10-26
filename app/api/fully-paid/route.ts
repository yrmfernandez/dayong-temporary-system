import { canAccessPath } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { accountsToRecord, certificatePrefixes, listFullPayments, recordFullPayment, removeFullPayment, setCertificatePrefix, setCertificateRelease } from "@/lib/full-payments";
import { inTransaction } from "@/lib/db";

/** The Fully Paid page (app/fully-paid): whoever has the page in Roles → Page access (Administrators, IT, Finance by default). */
async function allowedUser() {
  const user = await getSessionUser();
  return user && canAccessPath(user, "/fully-paid") ? user : null;
}
const denied = () => Response.json({ success: false, message: "You do not have access to Fully Paid." }, { status: 403 });
const text = (value: unknown) => String(value ?? "").trim();

/** The list (?branch=&status=&search=), the branches' certificate prefixes, or one member's accounts to record (?member=). */
export async function GET(request: Request) {
  if (!(await allowedUser())) return denied();
  try {
    const params = new URL(request.url).searchParams;
    if (params.get("member")) return Response.json({ success: true, accounts: await accountsToRecord(params.get("member") ?? "") }, { headers: { "Cache-Control": "private, no-store" } });
    const [items, prefixes] = await Promise.all([listFullPayments({ branch: params.get("branch") ?? "", status: params.get("status") ?? "", search: params.get("search") ?? "" }), certificatePrefixes()]);
    return Response.json({ success: true, items, prefixes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load." }, { status: 400 });
  }
}

/** { action: record | release | pending | remove | prefix, ... } */
export const POST = withEncoder(async (request: Request) => {
  if (!(await allowedUser())) return denied();
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "record": {
        const saved = await inTransaction((tx) => recordFullPayment(tx, { enrollmentId: text(body.enrollmentId), paidOn: text(body.paidOn), total: Number(body.total), source: "Manual", certificateNumber: text(body.certificateNumber) || undefined }));
        return Response.json({ success: true, message: `Recorded Fully Paid; certificate ${saved.certificateNumber}.` });
      }
      case "release":
        await setCertificateRelease(text(body.enrollmentId), true, text(body.releasedOn), text(body.receivedBy));
        return Response.json({ success: true, message: "Certificate marked released." });
      case "pending":
        await setCertificateRelease(text(body.enrollmentId), false);
        return Response.json({ success: true, message: "Certificate marked pending." });
      case "remove":
        await removeFullPayment(text(body.enrollmentId), text(body.reason));
        return Response.json({ success: true, message: "Full payment removed; the status is worked out from the receipts again." });
      case "prefix":
        await setCertificatePrefix(text(body.branchId), text(body.prefix));
        return Response.json({ success: true, message: "Certificate prefix saved." });
      default:
        return Response.json({ success: false, message: "Unknown action." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save." }, { status: 400 });
  }
});

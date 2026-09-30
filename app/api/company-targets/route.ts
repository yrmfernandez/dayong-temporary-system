import { getSessionUser } from "@/lib/auth-server";
import { saveCompanyTarget } from "@/lib/company-targets";
import { withEncoder } from "@/lib/encoder-context";

// Company targets are set by the executives who are measured against them, and by administrators.
const canSetTargets = (roleNames: string[]) => roleNames.some((role) => ["administrator", "admin", "ceo", "president"].includes(role.trim().toLowerCase()));

export const POST = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user || !canSetTargets(user.roleNames)) return Response.json({ success: false, message: "Only the CEO, President, or an administrator can set company targets." }, { status: 403 });
  try { return Response.json({ success: true, target: await saveCompanyTarget(await request.json()) }); }
  catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the target." }, { status: 400 }); }
});

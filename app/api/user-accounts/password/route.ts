import { NextResponse } from "next/server";

import { canManageAccounts } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { resetUserPassword } from "@/lib/master-data-crud";
import { guardAccountChange } from "@/lib/privilege-guard";

/** Forgotten password: IT issues a one-time password, shown only in this response, to hand over in person or by text. */
export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageAccounts())) return NextResponse.json({ success: false, message: "Only IT or an administrator can reset passwords." }, { status: 403 });
  try {
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ success: false, message: "Choose an account." }, { status: 400 });
    const denied = await guardAccountChange({ accountId: id });
    if (denied) return NextResponse.json({ success: false, message: denied }, { status: 403 });
    return NextResponse.json({ success: true, account: await resetUserPassword(id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to reset the password." }, { status: 400 });
  }
});

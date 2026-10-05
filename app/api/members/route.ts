import { NextResponse } from "next/server";
import { userWithPageAccess } from "@/lib/auth-server";

import { searchMembersByName } from "@/lib/member-records";

export async function GET(request: Request) {
  if (!(await userWithPageAccess("/new-sales", "/collections"))) return NextResponse.json({ success: false, message: "You do not have access to member encoding." }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const branch = searchParams.get("branch")?.trim() ?? "";
    const mas = searchParams.get("mas")?.trim() ?? "";

    // New Sales searches all members; Collections searches one branch and MAS.
    if (!search || (!branch !== !mas) || (!branch && !(await userWithPageAccess("/new-sales")))) {
      return NextResponse.json({
        success: true,
        members: [],
      });
    }

    const members = await searchMembersByName(search, branch, mas);

    return NextResponse.json({
      success: true,
      members,
    });
  } catch (error) {
    console.error("Member search error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to search members.",
      },
      {
        status: 500,
      },
    );
  }
}

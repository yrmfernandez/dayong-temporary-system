import { NextResponse } from "next/server";
import { userWithPageAccess } from "@/lib/auth-server";

import { findSameNameMembers, listMembersForMas, searchBranchMembers, searchMembersByName } from "@/lib/member-records";

export async function GET(request: Request) {
  if (!(await userWithPageAccess("/new-sales", "/mas-sales", "/collections"))) return NextResponse.json({ success: false, message: "You do not have access to member encoding." }, { status: 403 });
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const branch = searchParams.get("branch")?.trim() ?? "";
    const mas = searchParams.get("mas")?.trim() ?? "";

    // Collections, DTO batch (paid at the office): any member with an active account in the branch, typed at least 2 letters.
    if (searchParams.get("dto") === "1") {
      return NextResponse.json({ success: true, members: await searchBranchMembers(search, branch) });
    }

    // New Sales: members with the exact surname and first name typed for a new member, to ask whether it is the same person.
    if (searchParams.get("sameName") === "1") {
      if (!(await userWithPageAccess("/new-sales", "/mas-sales"))) return NextResponse.json({ success: true, members: [] });
      return NextResponse.json({ success: true, members: await findSameNameMembers(searchParams.get("surname") ?? "", searchParams.get("firstName") ?? "") });
    }

    // Collections: every member under the chosen branch and MAS, so the member field lists them before any typing.
    if (searchParams.get("all") === "1") {
      return NextResponse.json({ success: true, members: branch && mas ? await listMembersForMas(branch, mas) : [] });
    }

    // New Sales searches all members; Collections searches one branch and MAS.
    if (!search || (!branch !== !mas) || (!branch && !(await userWithPageAccess("/new-sales", "/mas-sales")))) {
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

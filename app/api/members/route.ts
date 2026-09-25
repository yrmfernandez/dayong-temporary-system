import { NextResponse } from "next/server";

import { searchMembersByName } from "@/lib/google-sheets-data";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search")?.trim() ?? "";
    const branch = searchParams.get("branch")?.trim() ?? "";
    const mas = searchParams.get("mas")?.trim() ?? "";

    if (!search || !branch || !mas) {
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

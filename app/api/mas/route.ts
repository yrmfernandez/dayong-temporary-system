import { NextResponse } from "next/server";
import { getActiveMasStaff } from "@/lib/google-sheets-data";

export async function GET() {
  try {
    return NextResponse.json({ success: true, staff: await getActiveMasStaff() });
  } catch (error) {
    console.error("Load MAS staff error:", error);
    return NextResponse.json({ success: false, message: "Unable to load MAS staff." }, { status: 500 });
  }
}

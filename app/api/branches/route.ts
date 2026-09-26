import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import {
  createBranch,
  getBranches,
} from "@/lib/google-sheets-data";

export async function GET() {
  try {
    const branches = await getBranches();

    return NextResponse.json({
      success: true,
      branches,
    });
  } catch (error) {
    console.error("Get branches error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to load branches.",
      },
      { status: 500 },
    );
  }
}

export const POST = withEncoder(async function POST(request: Request) {
  try {
    const body = await request.json();
    const readField = (field: string) =>
      typeof body[field] === "string" ? body[field] : "";
    const name =
      typeof body.name === "string" ? body.name.trim() : "";

    if (!name) {
      return NextResponse.json(
        {
          success: false,
          message: "Branch name is required.",
        },
        { status: 400 },
      );
    }

    const branches = await getBranches();
    const duplicate = branches.some(
      (branch) => branch.name.toLowerCase() === name.toLowerCase() && branch.territory.toLowerCase() === readField("territory").trim().toLowerCase(),
    );

    if (duplicate) {
      return NextResponse.json(
        {
          success: false,
          message: "A branch with this name already exists.",
        },
        { status: 409 },
      );
    }

    const branch = await createBranch({
      name,
      territory: readField("territory"),
      barangay: readField("barangay"),
      cityMunicipality: readField("cityMunicipality"),
      province: readField("province"),
      country: readField("country"),
      postalCode: readField("postalCode"),
      contactNumber: readField("contactNumber"),
      email: readField("email"),
      dateOpened: readField("dateOpened"),
      dateClosed: readField("dateClosed"),
      status: body.status === "inactive" ? "inactive" : "active",
    });

    return NextResponse.json(
      { success: true, branch },
      { status: 201 },
    );
  } catch (error) {
    console.error("Create branch error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Unable to save branch.",
      },
      { status: 500 },
    );
  }
});

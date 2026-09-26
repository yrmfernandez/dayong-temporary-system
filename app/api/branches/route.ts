import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";
import { canManageUsers } from "@/lib/auth-server";
import { deleteBranchRecord, updateBranchRecord, type BranchInput } from "@/lib/master-data-crud";

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
      canManage: await canManageUsers(),
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
  if (!(await canManageUsers())) return NextResponse.json({ success: false, message: "You are not allowed to create branches." }, { status: 403 });
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

function branchInput(body: Record<string, unknown>): BranchInput {
  const value = (key: string) => typeof body[key] === "string" ? body[key].trim() : "";
  return { name: value("name"), territory: value("territory"), barangay: value("barangay"), cityMunicipality: value("cityMunicipality"), province: value("province"), country: value("country"), postalCode: value("postalCode"), contactNumber: value("contactNumber"), email: value("email"), dateOpened: value("dateOpened"), dateClosed: value("dateClosed"), status: body.status === "inactive" ? "inactive" : "active" };
}

export const PUT = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return NextResponse.json({ success: false, message: "You are not allowed to update branches." }, { status: 403 });
  try { const id = new URL(request.url).searchParams.get("id")?.trim() ?? ""; const body = await request.json(); return NextResponse.json({ success: true, branch: await updateBranchRecord(id, branchInput(body)) }); }
  catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to update branch." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return NextResponse.json({ success: false, message: "You are not allowed to delete branches." }, { status: 403 });
  try { const id = new URL(request.url).searchParams.get("id")?.trim() ?? ""; await deleteBranchRecord(id); return NextResponse.json({ success: true }); }
  catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to delete branch." }, { status: 400 }); }
});

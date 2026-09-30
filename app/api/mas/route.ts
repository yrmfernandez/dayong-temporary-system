import { NextResponse } from "next/server";
import { userWithPageAccess } from "@/lib/auth-server";
import { getEmployees } from "@/lib/employees";

export async function GET() {
  if (!(await userWithPageAccess("/new-sales", "/collections"))) return NextResponse.json({ success: false, message: "You do not have access to member encoding." }, { status: 403 });
  try {
    const employees=await getEmployees();
    return NextResponse.json({ success: true, staff: employees.filter(employee=>employee.status.toLowerCase()==="active").map(employee=>({employeeId:employee.id,fullName:employee.name,branchIds:employee.branchIds})) });
  } catch (error) {
    console.error("Load MAS staff error:", error);
    return NextResponse.json({ success: false, message: "Unable to load MAS staff." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";
import { getEmployees } from "@/lib/employees";

export async function GET() {
  try {
    const employees=await getEmployees();
    return NextResponse.json({ success: true, staff: employees.filter(employee=>employee.status.toLowerCase()==="active").map(employee=>({employeeId:employee.id,fullName:employee.name,branchIds:employee.branchIds})) });
  } catch (error) {
    console.error("Load MAS staff error:", error);
    return NextResponse.json({ success: false, message: "Unable to load MAS staff." }, { status: 500 });
  }
}

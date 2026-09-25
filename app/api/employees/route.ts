import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { getEmployees, registerEmployee } from "@/lib/employees";

export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  try {
    return Response.json({ success: true, employees: await getEmployees(), canRegister: await canManageUsers() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Employee directory error:", error);
    return Response.json({ success: false, message: "Unable to load employees. Check the Employees sheet setup." }, { status: 500 });
  }
}
export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "You are not allowed to register employees." }, { status: 403 });
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid employee details.");
    return Response.json({ success: true, employee: await registerEmployee(body) }, { status: 201 });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to register employee." }, { status: 400 }); }
});

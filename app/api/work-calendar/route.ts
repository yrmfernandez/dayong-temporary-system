import { getSessionUser } from "@/lib/auth-server";
import { declaredNonWorkingDays } from "@/lib/work-calendar";

/** The declared non-working days, for the entry forms' late-date checks (lib/working-days.ts). Any signed-in user. */
export async function GET() {
  if (!(await getSessionUser())) return Response.json({ success: false, message: "Sign in first." }, { status: 401 });
  try {
    return Response.json({ success: true, days: await declaredNonWorkingDays() }, { headers: { "Cache-Control": "private, max-age=60" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load the calendar." }, { status: 500 });
  }
}

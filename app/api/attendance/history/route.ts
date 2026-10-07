import { getPhilippineDate } from "@/lib/attendance";
import { getEmployeeAttendance } from "@/lib/attendance-data";
import { isHistoryPeriod, periodRange, summarizeHistory } from "@/lib/attendance-board";
import { getSessionUser } from "@/lib/auth-server";

/** The signed-in employee's own attendance for one week, month or year (?period=week|month|year&date=YYYY-MM-DD). */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!user.employeeId) return Response.json({ success: false, message: "Your account is not linked to an employee." }, { status: 400 });

  const params = new URL(request.url).searchParams;
  const period = params.get("period") ?? "month";
  const today = getPhilippineDate();
  const date = params.get("date") ?? today;
  if (!isHistoryPeriod(period)) return Response.json({ success: false, message: "Choose week, month or year." }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00Z`).getTime())) return Response.json({ success: false, message: "Choose a valid date." }, { status: 400 });

  try {
    const range = periodRange(period, date);
    const records = await getEmployeeAttendance(user.employeeId, range.from, range.to);
    return Response.json({ success: true, history: { period, today, ...range, ...summarizeHistory(period, records, today) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Attendance history error:", error);
    return Response.json({ success: false, message: "Unable to load your attendance history." }, { status: 500 });
  }
}

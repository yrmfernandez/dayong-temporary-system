import {
  addPhilippineHolidays,
  closureCovers,
  declareClosure,
  deleteHoliday,
  employeeAttendanceBranches,
  getClosures,
  getHolidays,
  removeClosure,
  saveHoliday,
} from "@/lib/attendance-calendar";
import { canManageAttendance, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { getBranches } from "@/lib/google-sheets-data";

const monthPattern = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * One month of the attendance calendar for any signed-in user: holidays, and the declared non-working days with the
 * branches they close. Managers also get the branch list and whether the year's Philippine holidays were added.
 */
export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ success: false, message: "Please sign in." }, { status: 401 });
  const month = new URL(request.url).searchParams.get("month")?.trim() ?? "";
  const match = monthPattern.exec(month);
  if (!match) return Response.json({ success: false, message: "Choose a valid month." }, { status: 400 });
  try {
    const year = Number(match[1]);
    const lastDay = new Date(Date.UTC(year, Number(match[2]), 0)).getUTCDate();
    const from = `${month}-01`, to = `${month}-${String(lastDay).padStart(2, "0")}`;
    const canManage = await canManageAttendance();
    const [holidays, closures, branchesByEmployee, yearHolidays, branches] = await Promise.all([
      getHolidays(from, to), getClosures(from, to), employeeAttendanceBranches(),
      canManage ? getHolidays(`${year}-01-01`, `${year}-12-31`) : Promise.resolve([]),
      canManage ? getBranches() : Promise.resolve([]),
    ]);
    const myBranch = branchesByEmployee.get(user.employeeId) ?? "";
    return Response.json({
      success: true, month, canManage, myBranch, holidays,
      closures: closures.map((closure) => ({ ...closure, appliesToMe: Boolean(myBranch) && closureCovers(closure, myBranch) })),
      yearHolidayCount: yearHolidays.length,
      branches: branches.filter((branch) => branch.status === "active").map((branch) => ({ id: branch.id, name: branch.name })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Load attendance calendar error:", error);
    return Response.json({ success: false, message: "Unable to load the calendar." }, { status: 500 });
  }
}

/** Calendar changes by HR and administrators: holidays, the yearly Philippine list, and non-working days. */
export const POST = withEncoder(async (request: Request) => {
  if (!(await canManageAttendance())) return Response.json({ success: false, message: "You are not allowed to manage the attendance calendar." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    switch (body.action) {
      case "save-holiday": {
        const holiday = await saveHoliday(body);
        return Response.json({ success: true, message: `${holiday.name} saved.`, holiday });
      }
      case "delete-holiday":
        await deleteHoliday(typeof body.id === "string" ? body.id.trim() : "");
        return Response.json({ success: true, message: "Holiday removed." });
      case "add-philippine-holidays": {
        const added = await addPhilippineHolidays(Number(body.year));
        return Response.json({ success: true, message: added ? `${added} Philippine holiday${added === 1 ? "" : "s"} added for ${body.year}. Review them, then declare the ones the company will close.` : `The Philippine holidays for ${body.year} are already in the calendar.` });
      }
      case "declare-closure": {
        const by = (await getSessionUser())?.name || "an administrator";
        const { cancelled, scope } = await declareClosure(body, by);
        return Response.json({ success: true, message: `Non-working day saved for ${scope}.${cancelled ? ` ${cancelled} clock-in${cancelled === 1 ? "" : "s"} cancelled.` : ""}` });
      }
      case "remove-closure":
        await removeClosure(typeof body.date === "string" ? body.date.trim() : "");
        return Response.json({ success: true, message: "Non-working day removed. Attendance is open again for that date." });
      default:
        return Response.json({ success: false, message: "Unknown calendar action." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to update the calendar." }, { status: 400 });
  }
});

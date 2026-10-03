import { canAccessPath } from "@/lib/access-control";
import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { correctSaleOrCollection } from "@/lib/entry-corrections";
import { manilaNow } from "@/lib/remittance-deadline";
import { getTodayMode, isTodayMode, setTodayMode } from "@/lib/system-settings";
import { getEntriesForDay } from "@/lib/todays-entries";

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

async function allowedUser() {
  const user = await getSessionUser();
  return user && canAccessPath(user, "/todays-entries") ? user : null;
}

/** New Sales and Collections for one day, counted by the requested mode or the company default. */
export async function GET(request: Request) {
  if (!(await allowedUser())) return Response.json({ success: false, message: "You do not have access to Today's Entries." }, { status: 403 });
  try {
    const params = new URL(request.url).searchParams;
    const today = manilaNow().date;
    const date = params.get("date")?.trim() || today;
    if (!validDate(date)) throw new Error("Choose a valid date.");
    const defaultMode = await getTodayMode();
    const requested = params.get("mode");
    const mode = isTodayMode(requested) ? requested : defaultMode;
    const result = await getEntriesForDay(date, mode);
    return Response.json({ success: true, date, today, mode, defaultMode, canEdit: await canManageUsers(), ...result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to load today's entries." }, { status: 400 });
  }
}

/** Administrators choose how "today" is counted for everyone (this page and the dashboards). */
export const POST = withEncoder(async (request: Request) => {
  const user = await allowedUser();
  if (!user || !(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    const body = await request.json();
    const mode = await setTodayMode(body.mode, user.name);
    return Response.json({ success: true, mode, message: "Default view saved for everyone." });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the setting." }, { status: 400 });
  }
});

/** Administrator correction of a New Sale or Collection; the reason is kept in Record Corrections. */
export const PATCH = withEncoder(async (request: Request) => {
  if (!(await allowedUser()) || !(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    return Response.json({ success: true, ...(await correctSaleOrCollection(await request.json())) });
  } catch (error) {
    return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct the entry." }, { status: 400 });
  }
});

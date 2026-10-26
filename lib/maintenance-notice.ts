import { DEFAULT_MAINTENANCE_MESSAGE, MAINTENANCE_MESSAGE_MAX, type MaintenanceNotice } from "@/lib/maintenance-notice-text";
import { getSetting, saveSetting } from "@/lib/system-settings";

export { DEFAULT_MAINTENANCE_MESSAGE, MAINTENANCE_MESSAGE_MAX, type MaintenanceNotice } from "@/lib/maintenance-notice-text";

/**
 * The maintenance notice (owner, October 26, 2026): IT turns it on from System Health while updating the system or
 * adjusting the database, and every signed-in user sees it at the top of every page (like the Notice to Explain
 * banner), so slowness or an error during that time is expected. IT turns it off when done. One system setting.
 */
const KEY = "maintenance_notice";
const OFF: MaintenanceNotice = { on: false, message: "", startedAt: "", by: "" };

export async function getMaintenanceNotice(): Promise<MaintenanceNotice> {
  try {
    const saved = JSON.parse(await getSetting(KEY) || "null") as Partial<MaintenanceNotice> | null;
    if (!saved?.on) return OFF;
    return { on: true, message: String(saved.message ?? "").trim() || DEFAULT_MAINTENANCE_MESSAGE, startedAt: String(saved.startedAt ?? ""), by: String(saved.by ?? "") };
  } catch {
    return OFF;
  }
}

/** Turns the notice on with `message` (the default when blank), or off. */
export async function setMaintenanceNotice(on: boolean, message: unknown, by: string) {
  const text = String(message ?? "").trim();
  if (text.length > MAINTENANCE_MESSAGE_MAX) throw new Error(`Keep the notice to ${MAINTENANCE_MESSAGE_MAX} characters.`);
  const notice: MaintenanceNotice = on ? { on: true, message: text || DEFAULT_MAINTENANCE_MESSAGE, startedAt: new Date().toISOString(), by } : OFF;
  await saveSetting(KEY, JSON.stringify(notice), by);
  return notice;
}

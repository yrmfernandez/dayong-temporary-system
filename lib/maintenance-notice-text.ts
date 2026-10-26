/** The maintenance notice's shape and texts, safe in the browser (the setting itself: lib/maintenance-notice.ts). */
export type MaintenanceNotice = { on: boolean; message: string; startedAt: string; by: string };

export const MAINTENANCE_MESSAGE_MAX = 300;
export const DEFAULT_MAINTENANCE_MESSAGE = "Your cute IT is updating the system right now. You may notice slowness or errors for a while; if something fails, wait a few minutes and try again.";

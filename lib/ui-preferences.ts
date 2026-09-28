export type IndicatorStyle = "pill" | "line";
export type TableDensity = "comfortable" | "compact";

export const preferenceKeys = {
  activeRole: "dayong-active-role",
  collapsed: "dayong-sidebar-collapsed",
  indicator: "dayong-sidebar-indicator",
  density: "dayong-table-density",
} as const;

const changeEvent = "dayong-preferences";

// Storage can throw in private windows or when site data is blocked; preferences are conveniences only.
export function readPreference(key: string, fallback = "") {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* keep the in-memory value */ }
  window.dispatchEvent(new Event(changeEvent));
}

export function removePreference(key: string) {
  try { localStorage.removeItem(key); } catch { /* nothing stored */ }
}

export function onPreferencesChange(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  window.addEventListener("storage", listener);
  return () => { window.removeEventListener(changeEvent, listener); window.removeEventListener("storage", listener); };
}

export const readIndicator = (): IndicatorStyle => readPreference(preferenceKeys.indicator) === "line" ? "line" : "pill";
export const readDensity = (): TableDensity => readPreference(preferenceKeys.density) === "compact" ? "compact" : "comfortable";

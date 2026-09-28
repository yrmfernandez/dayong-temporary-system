export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "dayong-theme";
const changeEvent = "dayong-theme-change";

// Runs in <head> before first paint so the page never flashes the wrong theme.
export const themeBootScript = `(function(){try{var t=localStorage.getItem("${THEME_KEY}")||"system";var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

export function resolveTheme(preference: ThemePreference) {
  return preference === "system" ? (systemPrefersDark() ? "dark" : "light") : preference;
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  // Suppress transitions for one frame so every surface switches together.
  root.classList.add("theme-switching");
  root.classList.toggle("dark", resolveTheme(preference) === "dark");
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => root.classList.remove("theme-switching")));
}

export function setTheme(preference: ThemePreference) {
  try { localStorage.setItem(THEME_KEY, preference); } catch { /* keep the in-memory choice */ }
  applyTheme(preference);
  window.dispatchEvent(new Event(changeEvent));
}

/** Keeps the page in sync with the saved choice, the OS setting (for "system"), other tabs, and printing. */
export function watchTheme(onChange: (preference: ThemePreference) => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const sync = () => { const preference = readTheme(); applyTheme(preference); onChange(preference); };
  const onStorage = (event: StorageEvent) => { if (event.key === THEME_KEY) sync(); };
  const onSystem = () => { if (readTheme() === "system") sync(); };
  // Reports print on white paper regardless of the screen theme.
  const beforePrint = () => document.documentElement.classList.remove("dark");
  const afterPrint = () => applyTheme(readTheme());
  window.addEventListener(changeEvent, sync);
  window.addEventListener("storage", onStorage);
  media.addEventListener("change", onSystem);
  window.addEventListener("beforeprint", beforePrint);
  window.addEventListener("afterprint", afterPrint);
  sync();
  return () => {
    window.removeEventListener(changeEvent, sync);
    window.removeEventListener("storage", onStorage);
    media.removeEventListener("change", onSystem);
    window.removeEventListener("beforeprint", beforePrint);
    window.removeEventListener("afterprint", afterPrint);
  };
}

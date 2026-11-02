/**
 * Scrolls the page back to the top. Pages scroll inside the app shell's main panel (components/app-shell.tsx,
 * `.app-main`), not the window, so window.scrollTo alone does nothing there; the window is the fallback (login).
 */
export function scrollPageToTop() {
  const main = document.querySelector<HTMLElement>(".app-main");
  if (main) main.scrollTo({ top: 0, behavior: "smooth" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

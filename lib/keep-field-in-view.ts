/**
 * A phone's keyboard never covers the field being typed in (owner, November 5, 2026). One listener for the whole app,
 * installed by the app shell, so a new field needs nothing.
 *
 * While the keyboard is open the bars pinned to the screen stop being pinned (`data-keyboard` on <html>, app/globals.css):
 * the top bar, tabs and save bar took more than half of what the keyboard leaves. They return when it closes. The field
 * being typed in is then moved into what is left of the screen, with its label. Chrome on Android also shrinks the page
 * to fit (`interactiveWidget` in app/layout.tsx); Safari on iPhone does not, so `--keyboard-room` adds the room to scroll.
 */
type Span = { top: number; bottom: number };

// More than a browser's address bar coming and going, less than any keyboard.
const KEYBOARD_MIN_HEIGHT = 120;
// Room above a field for its label, and below it so it does not touch the keyboard.
const ROOM_ABOVE = 40;
const ROOM_BELOW = 16;

export const keyboardIsOpen = (fullHeight: number, height: number) => fullHeight - height > KEYBOARD_MIN_HEIGHT;

/** How far to scroll to bring the field into view: none if it is already clear, else to the middle of what is visible. */
export function scrollToShow(field: Span, visible: Span) {
  const top = visible.top + ROOM_ABOVE, bottom = visible.bottom - ROOM_BELOW;
  if (field.top >= top && field.bottom <= bottom) return 0;
  if (field.bottom - field.top > bottom - top) return field.top - top;
  return (field.top + field.bottom) / 2 - (top + bottom) / 2;
}

const NOT_TYPED_IN = ["button", "checkbox", "color", "file", "radio", "range", "submit"];
const typedIn = (element: Element | null): element is HTMLElement => element instanceof HTMLTextAreaElement || (element instanceof HTMLInputElement && !NOT_TYPED_IN.includes(element.type));

function reveal(view: VisualViewport) {
  const field = document.activeElement;
  if (!typedIn(field)) return;
  let left = scrollToShow(field.getBoundingClientRect(), { top: view.offsetTop, bottom: view.offsetTop + view.height });
  // Nearest scrolling box first: a list inside a card scrolls before the page does.
  for (let box = field.parentElement; box && left; box = box.parentElement) {
    if (!/auto|scroll/.test(getComputedStyle(box).overflowY)) continue;
    const before = box.scrollTop;
    box.scrollTop += left;
    left -= box.scrollTop - before;
  }
}

export function installKeepFieldInView() {
  if (typeof window === "undefined" || !window.visualViewport || !window.matchMedia("(pointer: coarse)").matches) return;
  const marked = window as Window & { dayongKeepField?: boolean };
  if (marked.dayongKeepField) return;
  marked.dayongKeepField = true;
  const view = window.visualViewport;
  const root = document.documentElement;
  // Sizes without the zoom: pinching in also makes the visible part smaller, and that is not a keyboard.
  let fullWidth = view.width * view.scale;
  let fullHeight = view.height * view.scale;
  view.addEventListener("resize", () => {
    const width = view.width * view.scale, height = view.height * view.scale;
    // Turning the phone starts over; otherwise the tallest seen is the height without the keyboard.
    fullHeight = width === fullWidth ? Math.max(fullHeight, height) : height;
    fullWidth = width;
    const open = keyboardIsOpen(fullHeight, height);
    root.toggleAttribute("data-keyboard", open);
    root.style.setProperty("--keyboard-room", `${Math.max(0, window.innerHeight - view.height)}px`);
    if (open) reveal(view);
  });
  // The next field, with the keyboard already open; the first one is handled when the keyboard opens, above.
  document.addEventListener("focusin", () => { if (root.hasAttribute("data-keyboard")) window.setTimeout(() => reveal(view), 50); }, true);
}

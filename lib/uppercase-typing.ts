/**
 * Everything typed into a text field is capitals, so the same word is always spelled the same way (owner, November 5,
 * 2026). One listener for the whole app, installed by the app shell, so a new field needs nothing: it also covers the
 * pop-ups outside the page. It acts on what is typed; records already saved stay as they are until someone edits them.
 *
 * Left as typed: anything that is not plain text (numbers, dates, contact numbers, type="email" and the like), passwords
 * and emails however the field is set up (Show password makes a password field plain text), search boxes, which only
 * look things up, and the sign-in page. `data-keep-case` on a field leaves it out too.
 */
type Field = { tagName: string; type?: string; id?: string; name?: string; autocomplete?: string; placeholder?: string; getAttribute(name: string): string | null; hasAttribute(name: string): boolean };

export function typesInCapitals(field: Field) {
  const tag = field.tagName.toUpperCase();
  if (tag !== "TEXTAREA" && !(tag === "INPUT" && field.type === "text")) return false;
  if (field.hasAttribute("data-keep-case") || field.getAttribute("role") === "combobox") return false;
  if (/pass|e-?mail|url|one-time|username/i.test(`${field.id ?? ""} ${field.name ?? ""} ${field.autocomplete ?? ""}`)) return false;
  return !/\b(search|find)\b/i.test(field.placeholder ?? "");
}

/**
 * Through the prototype's setter, not `field.value`: React keeps its own copy of the value on the field, and setting it
 * there would tell React nothing changed, so the page would keep the small letters.
 */
function raise(field: HTMLInputElement | HTMLTextAreaElement) {
  const upper = field.value.toUpperCase();
  if (upper === field.value) return false;
  const { selectionStart, selectionEnd } = field;
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, upper);
  field.setSelectionRange(selectionStart, selectionEnd);
  return true;
}

const fieldOf = (target: EventTarget | null) => {
  if (window.location.pathname === "/login") return null;
  return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && typesInCapitals(target) ? target : null;
};

export function installUppercaseTyping() {
  if (typeof window === "undefined") return;
  const marked = window as Window & { dayongUppercase?: boolean };
  if (marked.dayongUppercase) return;
  marked.dayongUppercase = true;
  // Capture: before React reads the field, so the page only ever holds capitals.
  document.addEventListener("input", (event) => {
    // A phone's keyboard is still building the word; changing it now breaks the typing. compositionend finishes it.
    if ((event as InputEvent).isComposing) return;
    const field = fieldOf(event.target);
    if (field) raise(field);
  }, true);
  document.addEventListener("compositionend", (event) => {
    const field = fieldOf(event.target);
    if (field && raise(field)) field.dispatchEvent(new Event("input", { bubbles: true }));
  }, true);
  // The phone's keyboard opens on capitals.
  document.addEventListener("focusin", (event) => { fieldOf(event.target)?.setAttribute("autocapitalize", "characters"); }, true);
}

/**
 * Capitals only where they belong (owner, November 23, 2026): a person's or a place's name and the codes written in
 * capitals (OR number, application number, Employee ID, references). Everything else, such as reasons, notes, remarks,
 * findings and descriptions, stays as typed. Until then every text field turned to capitals (owner, November 5, 2026).
 * One listener for the whole app, installed by the app shell, so a new field is covered by what it is called. It acts
 * on what is typed; records already saved stay as they are.
 *
 * A field is known by its id, name, placeholder, aria-label and label (a linked <label>, the <label> around it, or the
 * <Label> just before it). Never capitals: anything that is not plain text (numbers, dates, type="email" and the
 * like), passwords and emails however the field is set up, combo boxes and the sign-in page. `data-caps` on a field
 * asks for capitals and `data-keep-case` leaves it as typed, whatever it is called.
 */
type Field = { tagName: string; type?: string; id?: string; name?: string; autocomplete?: string; placeholder?: string; getAttribute(name: string): string | null; hasAttribute(name: string): boolean };

/** Words of a field that stays as typed, checked first: "Reason for an ID change" or "Reference or notes" are text. */
const KEEP_CASE = /\b(reasons?|notes?|remarks?|descriptions?|details?|messages?|findings?|purpose|explain|comments?|title|specify|why|roles?|categor(y|ies)|methods?|holidays?|search|find|look ?up)\b/i;

/** Words of a field written in capitals: a person, a place, or a code. */
const CAPITALS = new RegExp([
  // A person: member and claimant details, beneficiaries, payees, and staff named on a record.
  "\\b(sur ?name|first ?name|middle ?name|name ?ext(ension)?|extension|suffix|full ?name|complete ?name|names?|claimants?|beneficiar(y|ies)|payees?|members?|deceased|relationship|mas|marketing account staff|collectors?|officers?|department head|approved by|who approved|approver|received by|who received|prepared by|checked by)\\b",
  // A place: addresses and branches.
  "\\b(address(es)?|birthplace|place of birth|barangay|city|province|territory|country|street|purok|branch(es)?)\\b",
  // A code: receipt, application and ID numbers and other references.
  "\\b(or ?no|or ?number|application|app|employee ?id|id|code|certificate|cert|prefix|reference|ref|receipt|invoice|voucher|batch|slip|ph|transaction|deposit)\\b",
].join("|"), "i");

/** An OR number: "or" in an id or name (or-number, ins-or), or OR in capitals in the words shown; never the word "or". */
const orNumber = (field: Field, label: string) =>
  /\bor\b/i.test(`${field.id ?? ""} ${field.name ?? ""}`.replace(/[-_]+/g, " ")) || /\bOR\b/.test(`${field.placeholder ?? ""} ${field.getAttribute("aria-label") ?? ""} ${label}`);

/** What a field is called, as words: its id, name, placeholder, aria-label and label (sp-surname → sp surname). */
export function fieldWords(field: Field, label = "") {
  return [field.id, field.name, field.placeholder, field.getAttribute("aria-label"), label]
    .filter(Boolean).join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ");
}

/** Whether what is typed into this field turns to capitals; `label` is the text of its label. */
export function typesInCapitals(field: Field, label = "") {
  const tag = field.tagName.toUpperCase();
  if (tag !== "TEXTAREA" && !(tag === "INPUT" && field.type === "text")) return false;
  if (field.hasAttribute("data-keep-case") || field.getAttribute("role") === "combobox") return false;
  if (/pass|e-?mail|url|one-time|username/i.test(`${field.id ?? ""} ${field.name ?? ""} ${field.autocomplete ?? ""}`)) return false;
  if (field.hasAttribute("data-caps")) return true;
  const words = fieldWords(field, label);
  return !KEEP_CASE.test(words) && (CAPITALS.test(words) || orNumber(field, label));
}

/** The text of a label up to the field inside it, so help text after the field does not count. */
function textBefore(label: Element, field: Element) {
  let text = "";
  for (const node of Array.from(label.childNodes)) {
    if (node === field || (node instanceof Element && node.contains(field))) break;
    text += ` ${node.textContent ?? ""}`;
  }
  return text;
}

/** The label of a field: a linked or surrounding <label>, else the <label> just before it or before its wrapper. */
function labelOf(field: HTMLInputElement | HTMLTextAreaElement) {
  const linked = Array.from(field.labels ?? []).map((label) => textBefore(label, field)).join(" ").trim();
  if (linked) return linked;
  let node: Element | null = field;
  for (let level = 0; node && level < 3; level += 1, node = node.parentElement) {
    for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
      if (sibling.tagName === "LABEL") return sibling.textContent ?? "";
      if (sibling.matches("input, textarea, select")) break;
    }
  }
  return "";
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
  return (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && typesInCapitals(target, labelOf(target)) ? target : null;
};

export function installUppercaseTyping() {
  if (typeof window === "undefined") return;
  const marked = window as Window & { dayongUppercase?: boolean };
  if (marked.dayongUppercase) return;
  marked.dayongUppercase = true;
  // Capture: before React reads the field, so the page only ever holds capitals in a capitals field.
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
  // The phone's keyboard opens on capitals in a capitals field, and on sentence case elsewhere.
  document.addEventListener("focusin", (event) => {
    const target = event.target;
    if (window.location.pathname === "/login" || !(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) || target.hasAttribute("autocapitalize")) return;
    target.setAttribute("autocapitalize", fieldOf(target) ? "characters" : "sentences");
  }, true);
}

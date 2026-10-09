import type { KeyboardEvent } from "react";

/**
 * Enter moves to the next field (October 9, 2026), so encoders keep their hands on the keyboard. Put it on a form's
 * wrapper: `<div onKeyDown={enterToNextField}>`. Only plain text, number and date inputs react; Enter keeps its usual
 * meaning in search lists (they pick the highlighted option), text areas, buttons and checkboxes. Disabled, read-only
 * and hidden fields are skipped; on the last field nothing happens.
 */
const SKIPPED_TYPES = new Set(["checkbox", "radio", "file", "submit", "button", "reset", "hidden", "range", "color"]);
const FIELDS = "input, select, textarea, [role='combobox']";

const usable = (element: HTMLElement) => {
  const field = element as HTMLInputElement;
  if (field.disabled || field.readOnly || element.tabIndex < 0 || element.getAttribute("aria-disabled") === "true") return false;
  if (element instanceof HTMLInputElement && SKIPPED_TYPES.has(element.type)) return false;
  return element.getClientRects().length > 0;
};

export function enterToNextField(event: KeyboardEvent<HTMLElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || event.defaultPrevented) return;
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || SKIPPED_TYPES.has(target.type) || target.getAttribute("role") === "combobox") return;
  const fields = [...event.currentTarget.querySelectorAll<HTMLElement>(FIELDS)].filter((element, index, all) => usable(element) && all.indexOf(element) === index);
  const position = fields.indexOf(target);
  const next = position >= 0 ? fields[position + 1] : undefined;
  if (!next) return;
  event.preventDefault();
  next.focus();
  // Typing replaces what is there; some browsers refuse select() on some input types.
  if (next instanceof HTMLInputElement) { try { next.select(); } catch { /* keep the caret */ } }
}

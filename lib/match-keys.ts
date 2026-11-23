// How names and phone numbers are compared when looking for the same person (November 23, 2026). The New Sale save,
// Edit batch, Collections and MAS submissions each had a copy; one copy keeps them matching the same way. Pure.

/** A name for comparing: trimmed, lower case, spaces collapsed. */
export const nameKey = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** Whether two names are the same apart from case and spacing. */
export const sameName = (a: unknown, b: unknown) => nameKey(a) === nameKey(b);

/** A phone number for comparing: digits only, +63 written as 0; "" when too short to be a phone number. */
export function phoneKey(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  return digits.length >= 10 ? digits : "";
}

// Program age restriction: Programs!N (age_restricted Yes/No), O (min_age), P (max_age, blank = no maximum).
export type AgeRestriction = { ageRestricted: boolean; minAge: number | null; maxAge: number | null };

const text = (value: unknown) => String(value ?? "").trim();
const wholeAge = (value: unknown) => {
  const raw = text(value);
  if (!raw) return null;
  const age = Number(raw);
  return Number.isInteger(age) ? age : NaN;
};

export function readAgeRestriction(row: unknown[]): AgeRestriction {
  const ageRestricted = ["yes", "true", "1"].includes(text(row[13]).toLowerCase()) || row[13] === true;
  const minAge = wholeAge(row[14]);
  const maxAge = wholeAge(row[15]);
  return { ageRestricted, minAge: ageRestricted && Number.isInteger(minAge) ? minAge : null, maxAge: ageRestricted && Number.isInteger(maxAge) ? maxAge : null };
}

/** Validates form input; minimum is required when restricted, maximum may be blank. */
export function normalizeAgeRestriction(input: { ageRestricted?: unknown; minAge?: unknown; maxAge?: unknown }): AgeRestriction {
  const ageRestricted = input.ageRestricted === true || text(input.ageRestricted).toLowerCase() === "true";
  if (!ageRestricted) return { ageRestricted: false, minAge: null, maxAge: null };
  const minAge = wholeAge(input.minAge);
  const maxAge = wholeAge(input.maxAge);
  if (minAge === null || !Number.isInteger(minAge) || minAge < 0 || minAge > 120) throw new Error("Enter a minimum age from 0 to 120 for the age restriction.");
  if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < minAge || maxAge > 120)) throw new Error("The maximum age must be a whole number from the minimum age to 120, or left blank.");
  return { ageRestricted, minAge, maxAge };
}

/** Sheet cells for Programs!N:P. */
export const ageRestrictionCells = (restriction: AgeRestriction) => [
  restriction.ageRestricted ? "Yes" : "No",
  restriction.minAge ?? "",
  restriction.maxAge ?? "",
];

export function describeAgeRestriction(restriction: AgeRestriction) {
  if (!restriction.ageRestricted || restriction.minAge === null) return "No age restriction";
  return restriction.maxAge === null ? `Ages ${restriction.minAge} and above` : `Ages ${restriction.minAge} to ${restriction.maxAge}`;
}

/** Age in whole years on a given YYYY-MM-DD date. */
export function ageOn(birthdate: string, onDate: string) {
  const birth = dateParts(birthdate);
  const on = dateParts(onDate);
  if (!birth || !on) return null;
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) age--;
  return age >= 0 ? age : null;
}

// Sheets may return birthdates as YYYY-MM-DD or as a formatted date such as 5/1/1990.
function dateParts(value: string) {
  const raw = text(value);
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(raw);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const parsed = raw ? new Date(raw) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return { year: parsed.getFullYear(), month: parsed.getMonth() + 1, day: parsed.getDate() };
}

/** A sheet date as YYYY-MM-DD (blank when it is not a date), so dates compare and fill date inputs consistently. */
export function isoDate(value: unknown) {
  const parts = dateParts(String(value ?? ""));
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}` : "";
}

/** Returns an error message when the member's age is outside the program's range, otherwise null. */
export function ageRestrictionError(restriction: AgeRestriction, birthdate: string, onDate: string) {
  if (!restriction.ageRestricted || restriction.minAge === null) return null;
  const age = ageOn(birthdate, onDate);
  if (age === null) return "A valid birthdate is required for this age-restricted program.";
  if (age < restriction.minAge || (restriction.maxAge !== null && age > restriction.maxAge)) return `Member age ${age} is outside this program's allowed range (${describeAgeRestriction(restriction).replace(/^Ages /, "ages ")}).`;
  return null;
}

/**
 * Is the person typed on a New Sale the existing member it is saved under? (owner, November 19, 2026)
 *
 * A New Sale for an existing member writes the details typed on it onto the member's record (lib/member-records.ts
 * updateMemberDetails). A MAS picked "PADILLA, ALIJANDRO DUMASIG" and typed another person, "PADILLA, JENELYN", over
 * him; the save replaced his name, birthdate, address and claimant, and his old account showed her name. Three more
 * old-data members were replaced the same way in November 2026 (scripts/undo-member-overwrite.mjs puts them back).
 *
 * The typed name must be the member's name, allowing what corrections look like: a typo (ALIJANDRO → ALEJANDRO), a
 * second word dropped or added (JULIANA TABAL → JULIANA, imports often joined the middle name to the first name), and
 * the surname and first name swapped (old data has some the wrong way round). Anything else is another person: pick
 * Not this member, or correct the member's name in Members first. Pure: used by the form, the MAS submission and the save.
 */

const words = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/[^A-Z ]/g, " ").split(/\s+/).filter(Boolean).map((word) => (word === "MA" ? "MARIA" : word));

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const kept = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length];
}

/** The same word, or a typo of it: about one letter in three may differ (REMEHEO / REMEGIO, ALBARADO / ALVARADO). */
const alike = (a: string, b: string) => a === b || distance(a, b) <= Math.max(1, Math.floor(Math.min(a.length, b.length) / 3));

/**
 * The same name: same words with typos allowed, or one is the other with words added, in order (JULIANA TABAL / JULIANA,
 * MAHINAY JOSEPHINE / JOSEPHINE: imports joined a middle name or surname to the first name).
 */
function sameName(recorded: string[], typed: string[]) {
  if (!recorded.length || !typed.length) return true;
  const shorter = recorded.length <= typed.length ? recorded : typed, longer = shorter === recorded ? typed : recorded;
  let at = 0;
  for (const word of shorter) {
    while (at < longer.length && !alike(word, longer[at])) at++;
    if (at === longer.length) return false;
    at++;
  }
  return true;
}

export type PersonName = { surname: unknown; firstName: unknown };

/** True when the typed surname and first name are the recorded member's (see above). */
export function isSamePerson(recorded: PersonName, typed: PersonName) {
  const surname = [words(recorded.surname), words(typed.surname)] as const, first = [words(recorded.firstName), words(typed.firstName)] as const;
  if (sameName(surname[0], surname[1]) && sameName(first[0], first[1])) return true;
  // Surname and first name the wrong way round on the record (or on the form).
  if (sameName(surname[0], first[1]) && sameName(first[0], surname[1])) return true;
  // The same words split differently between the two fields (FLORDELIZA DAWANG / DAWANG FLORDELIZA, ESPOSO NATHANIEL).
  const all = (a: string[], b: string[]) => [...a, ...b].sort();
  const recordedAll = all(surname[0], first[0]), typedAll = all(surname[1], first[1]);
  return recordedAll.length === typedAll.length && recordedAll.every((word, index) => alike(word, typedAll[index]));
}

const shown = (name: PersonName) => [String(name.surname ?? "").trim(), String(name.firstName ?? "").trim()].filter(Boolean).join(", ");

/** "" when the typed name is the member's; otherwise why the New Sale cannot be saved under that member. */
export function anotherPersonProblem(memberNumber: string, recorded: PersonName, typed: PersonName) {
  if (isSamePerson(recorded, typed)) return "";
  return `${shown(typed)} is not member ${memberNumber} (${shown(recorded)}). If this is another person, press Not this member so a new member is registered. If it is the same person and the name on record is wrong, correct it in Members first.`;
}

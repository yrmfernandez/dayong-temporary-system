/**
 * Matching an owner-supplied "First Middle Surname" to member records (owner, October 15, 2026), shared by
 * scripts/check-mas-members.mjs and scripts/transfer-mas-members.mjs. A record matches when either:
 *   - its surname is the name's last word, its first name starts with the first word, and the middle name agrees or is
 *     blank (some records carry the middle name in the first name, e.g. "FRANCISCA SESCON"); or
 *   - every word of the name is somewhere in the record's name, in any order (old-sheet names without a comma were
 *     split by guess on import, e.g. surname "BOLO", first name "MOMO WILLIAM").
 */
export const nameWords = (value) => String(value ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);

/** Members (member_id, member_number, first_name, middle_name, surname, full_name) that may match `name`; filter with matchesName. */
export function candidateMembers(sql, name) {
  const words = nameWords(name), surname = words[words.length - 1], first = words[0];
  return sql`select member_id, member_number, status, first_name, middle_name, surname, upper(concat_ws(' ', first_name, middle_name, surname)) as full_name
    from members where upper(concat_ws(' ', first_name, middle_name, surname)) like ${`%${surname}%`} and upper(concat_ws(' ', first_name, middle_name, surname)) like ${`%${first}%`}
    order by member_number`;
}

export function matchesName(record, name) {
  const words = nameWords(name), surname = words[words.length - 1], first = words[0], middle = words.slice(1, -1);
  const stored = new Set(nameWords(record.full_name));
  const bySurname = nameWords(record.surname).join(" ") === surname && (nameWords(record.first_name)[0] ?? "").startsWith(first)
    && (!middle.length || !record.middle_name || middle.every((part) => nameWords(record.middle_name).includes(part)));
  return bySurname || words.every((word) => stored.has(word));
}

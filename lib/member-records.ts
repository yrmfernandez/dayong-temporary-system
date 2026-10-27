import { and, asc, eq, sql } from "drizzle-orm";

import { createReadableId } from "@/lib/readable-id";
import { currentDb, schema } from "@/lib/db";
import { getEncoder } from "@/lib/encoder-context";
import { isoDate } from "@/lib/program-age";

/**
 * Members, program enrollments, New Sales and beneficiaries in the database. Called inside the New Sales save's
 * transaction (app/api/sales/route.ts), so a batch saves completely or not at all.
 */
const { beneficiaries, member_programs: memberPrograms, members, sales } = schema;

const text = (value: unknown) => String(value ?? "").trim();
/** Blank text is stored as null, as the copy from the sheets did. */
const optional = (value: unknown) => text(value) || null;
const optionalDate = (value: unknown) => isoDate(value) || null;
const optionalInteger = (value: unknown) => { const number = Number(text(value)); return text(value) && Number.isInteger(number) ? number : null; };
const optionalMoney = (value: unknown) => { const number = Number(text(value)); return text(value) && Number.isFinite(number) ? number : null; };
const yes = (value: unknown) => ["yes", "true"].includes(text(value).toLowerCase());
function encoded() {
  const actor = getEncoder();
  return { encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt };
}

export type MemberSheetData = {
  memberId: string;
  memberNumber: string;
  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
  birthdate: string;
  birthplace: string;
  gender: string;
  age: string;
  civilStatus: string;
  contactNumber: string;
  addressHouse: string;
  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: string;
  claimantAddressHouse: string;
  status: string;
};
export type MemberDetails = Omit<MemberSheetData, "memberId" | "memberNumber" | "status">;

/**
 * A member without a contact number gets their claimant's (owner, October 6 and 10, 2026), when it is a real number
 * (at least 7 digits, not "N/A" or "0"). Used for new members, member edits and New Sale records alike;
 * scripts/fill-member-contacts.mjs does the same for records saved before.
 */
export function memberContactOrClaimant(contact: unknown, claimantContact: unknown) {
  const own = String(contact ?? "").trim(), claimant = String(claimantContact ?? "").trim();
  return own || (claimant.replace(/[^0-9]/g, "").length >= 7 ? claimant : "");
}

/** Member detail columns, the same on members and sales (a New Sale keeps a copy of the details it was encoded with). */
export const memberColumns = (details: MemberDetails) => ({
  surname: text(details.surname), first_name: text(details.firstName), middle_name: optional(details.middleName), name_extension: optional(details.nameExtension),
  birthdate: optionalDate(details.birthdate), birthplace: optional(details.birthplace), gender: optional(details.gender), age: optionalInteger(details.age),
  civil_status: optional(details.civilStatus), member_contact: optional(memberContactOrClaimant(details.contactNumber, details.claimantContact)), address: optional(details.addressHouse),
  claimant_name: optional(details.claimantName), claimant_contact: optional(details.claimantContact), claimant_same_address: yes(details.claimantSameAsMember),
  claimant_address: optional(details.claimantAddressHouse),
});

export async function addMember(member: MemberSheetData) {
  await currentDb().insert(members).values({ member_id: member.memberId, member_number: text(member.memberNumber), ...memberColumns(member), status: optional(member.status), ...encoded() });
}

/**
 * Writes the details an encoder confirmed or corrected on a New Sale back to the existing member. A blank value keeps
 * what is on record; the member ID, number, and status never change. Returns whether anything changed.
 */
export async function updateMemberDetails(memberId: string, details: MemberDetails) {
  const db = currentDb();
  const [current] = await db.select().from(members).where(eq(members.member_id, memberId));
  if (!current) throw new Error(`Member ${memberId} could not be found.`);
  const given = memberColumns(details);
  const next: Partial<typeof members.$inferInsert> = {};
  for (const [column, value] of Object.entries(given) as Array<[keyof typeof given, unknown]>) {
    // Blank keeps the stored value. Claimant same-address is always answered Yes or No on the form.
    if (column !== "claimant_same_address" && (value === null || value === "")) continue;
    if (value !== current[column]) Object.assign(next, { [column]: value });
  }
  if (!Object.keys(next).length) return false;
  await db.update(members).set(next).where(eq(members.member_id, memberId));
  return true;
}

export async function addBeneficiaries(
  memberId: string,
  saleId: string,
  list: Array<{ id?: string; surname: string; firstName: string; middleName: string; birthdate: string; age: number | null; relationship: string }>,
) {
  if (!list.length) return;
  const identity = encoded();
  await currentDb().insert(beneficiaries).values(list.map((item) => ({
    beneficiary_id: createReadableId("BEN"), member_id: memberId, sale_id: saleId, surname: text(item.surname), first_name: text(item.firstName),
    middle_name: optional(item.middleName), birthdate: optionalDate(item.birthdate), age: Number(item.age) || 0, relationship: text(item.relationship), ...identity,
  })));
}

export async function findMemberByNumber(memberNumber: string) {
  const number = text(memberNumber);
  if (!number) return null;
  const [row] = await currentDb().select().from(members).where(eq(members.member_number, number));
  if (!row) return null;
  return { memberId: row.member_id, memberNumber: row.member_number, birthdate: row.birthdate ?? "", surname: row.surname, firstName: row.first_name, middleName: row.middle_name ?? "", nameExtension: row.name_extension ?? "" };
}

/**
 * Members whose name or member number contains `search` (at most 5). Collections searches one branch and MAS's active
 * enrollments and returns those programs; New Sales searches every member (no branch or MAS given).
 */
export async function searchMembersByName(search: string, branch: string, mas: string) {
  if (!text(search)) return [];
  return findMembers(search, branch, mas, 5);
}

/** Every member with an active enrollment under this branch and MAS, for the Collections member list (at most 1,000). */
export async function listMembersForMas(branch: string, mas: string) {
  if (!text(branch) || !text(mas)) return [];
  return findMembers("", branch, mas, 1000);
}

/** A DTO batch (Collections): members with an active account in the branch, whatever its MAS, by name or PH number. */
export async function searchBranchMembers(search: string, branch: string) {
  if (text(search).length < 2 || !text(branch)) return [];
  return findMembers(search, branch, ANY_MAS, 50);
}

/** findMembers' MAS for "any MAS of the branch". */
const ANY_MAS = "\u0000any";

async function findMembers(search: string, branch: string, mas: string, limit: number) {
  const term = text(search).toLowerCase();
  const normalizedBranch = text(branch).toLowerCase(), normalizedMas = text(mas).toLowerCase();
  const scoped = Boolean(normalizedBranch || normalizedMas);
  if ((!term && !scoped) || (scoped && (!normalizedBranch || !normalizedMas))) return [];
  const anyMas = mas === ANY_MAS;
  // Written with an explicit alias (mp) and table name: inside a subquery, Drizzle's column references are not
  // table-qualified, and an unqualified member_id would compare the enrollment with itself instead of with the member.
  const eligible = scoped
    ? sql`lower(trim(mp.branch)) = ${normalizedBranch} and ${anyMas ? sql`true` : sql`lower(trim(mp.mas)) = ${normalizedMas}`} and (coalesce(trim(mp.status), '') = '' or lower(trim(mp.status)) = 'active')`
    : sql`true`;
  const pattern = `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
  const fullName = sql`lower(regexp_replace(trim(concat_ws(' ', ${members.first_name}, ${members.middle_name}, ${members.surname})), '\\s+', ' ', 'g'))`;
  const programIds = sql<string[]>`coalesce((select array_agg(mp.program_id order by mp.program_id) from member_programs mp where mp.member_id = "members"."member_id" and ${eligible}), '{}')`;
  const rows = await currentDb().select({ member: members, programIds }).from(members)
    .where(and(
      term ? sql`(${fullName} like ${pattern} or lower(${members.member_number}) like ${pattern})` : undefined,
      scoped ? sql`exists (select 1 from member_programs mp where mp.member_id = "members"."member_id" and ${eligible})` : undefined,
    ))
    .orderBy(asc(members.surname), asc(members.first_name), asc(members.member_number))
    .limit(limit);
  return rows.map(({ member: row, programIds: ids }) => memberChoice(row, ids));
}

/**
 * Members with this exact surname and first name (owner, October 23, 2026): New Sales asks whether a new member typed
 * there is one of them, so the same person is not registered twice. Case, extra spaces and ñ do not matter.
 */
/**
 * First names that may be the same person's (owner, October 27, 2026: PH-91674008 was registered again because the old
 * record's first name was written differently, so the exact-name check found nothing): the same first word, "Ma." and
 * "Maria" alike, one name the start or the initial of the other ("Kris", "K." and "Kristine"), or a word in common
 * ("Maria Luz" and "Luz"). The clerk still decides in the pop-up.
 */
export function similarFirstNames(typed: string, stored: string) {
  const words = (value: string) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z ]/g, " ").split(/\s+/).filter(Boolean)
    .map((word) => (word === "ma" || word === "maria" ? "maria" : word));
  const a = words(typed), b = words(stored);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ") || a[0] === b[0]) return true;
  // "Kris" in "Kristine", but not "Juan" in "Juana": one more letter often makes another name (Juan/Juana, Mario/Maria).
  const startsAlike = (x: string, y: string) => (y.length === 1 ? x.startsWith(y) : y.length >= 3 && x.length - y.length >= 2 && x.startsWith(y));
  if (startsAlike(a[0], b[0]) || startsAlike(b[0], a[0])) return true;
  const shared = new Set(a.filter((word) => word !== "maria" && word.length > 1));
  return b.some((word) => shared.has(word));
}

export async function findSameNameMembers(surname: string, firstName: string) {
  const fold = (value: string) => text(value).toLowerCase().replace(/ñ/g, "n").replace(/\s+/g, " ");
  const last = fold(surname), first = fold(firstName);
  if (last.length < 2 || first.length < 2) return [];
  const folded = (column: typeof members.surname | typeof members.first_name) => sql`translate(lower(regexp_replace(trim(${column}), '\\s+', ' ', 'g')), 'ñ', 'n')`;
  const programIds = sql<string[]>`coalesce((select array_agg(mp.program_id order by mp.program_id) from member_programs mp where mp.member_id = "members"."member_id"), '{}')`;
  // Same surname, then a similar first name (similarFirstNames); exact first names come first.
  const rows = await currentDb().select({ member: members, programIds }).from(members)
    .where(sql`${folded(members.surname)} = ${last}`).orderBy(asc(members.member_number)).limit(200);
  return rows.filter(({ member: row }) => similarFirstNames(firstName, row.first_name))
    .sort((x, y) => Number(fold(y.member.first_name) === first) - Number(fold(x.member.first_name) === first))
    .slice(0, 10).map(({ member: row, programIds: ids }) => memberChoice(row, ids));
}

function memberChoice(row: typeof members.$inferSelect, ids: string[]) {
  return ({
    id: row.member_id,
    phMemberNumber: row.member_number,
    programIds: ids,
    name: { surname: row.surname, firstName: row.first_name, middleName: row.middle_name ?? "", nameExtension: row.name_extension ?? "" },
    // YYYY-MM-DD, so selecting the member fills New Sales' date input.
    birthdate: row.birthdate ?? "",
    birthplace: row.birthplace ?? "",
    gender: row.gender ?? "",
    age: row.age,
    civilStatus: row.civil_status ?? "",
    contactNumber: row.member_contact ?? "",
    address: { houseBlockLot: row.address ?? "" },
    claimant: {
      completeName: row.claimant_name ?? "",
      contactNumber: row.claimant_contact ?? "",
      sameAsMemberAddress: row.claimant_same_address,
      address: { houseBlockLot: row.claimant_address ?? "" },
    },
  });
}

export type MemberProgramSheetData = {
  enrollmentId: string;
  memberId: string;
  memberNumber: string;
  programId: string;
  doi: string;
  /** HH:MM, the time of the DOI. */
  doiTime?: string;
  branch: string;
  mas: string;
  paymentMethod: string;
  registrationFee: string;
  registrationAmount: string;
  amountPaid: string;
  programTerms: string;
  status: string;
  dateCreated: string;
};

export async function findMemberProgramEnrollment(memberNumber: string, programId: string) {
  const number = text(memberNumber), program = text(programId);
  if (!number || !program) return null;
  const [row] = await currentDb().select().from(memberPrograms).where(and(eq(memberPrograms.member_number, number), eq(memberPrograms.program_id, program)));
  if (!row) return null;
  return { enrollmentId: row.enrollment_id, memberId: row.member_id, memberNumber: row.member_number ?? "", programId: row.program_id, branch: row.branch ?? "", mas: row.mas ?? "" };
}

/** A new program account starts "NS" (New Sale) until its first collection sets its status. */
export async function addMemberProgram(enrollment: MemberProgramSheetData) {
  await currentDb().insert(memberPrograms).values({
    enrollment_id: enrollment.enrollmentId, member_id: enrollment.memberId, member_number: text(enrollment.memberNumber), program_id: text(enrollment.programId),
    doi: optionalDate(enrollment.doi), doi_time: optional(enrollment.doiTime), branch: optional(enrollment.branch), mas: optional(enrollment.mas), remittance_method: optional(enrollment.paymentMethod),
    registration_fee: yes(enrollment.registrationFee), registration_amount: optionalMoney(enrollment.registrationAmount), amount_paid: optionalMoney(enrollment.amountPaid),
    program_terms: optional(enrollment.programTerms), status: optional(enrollment.status), date_created: optional(enrollment.dateCreated), ...encoded(), account_status: "NS",
  });
}

export type SaleSheetData = {
  saleId: string;
  dateCreated: string;
  branch: string;
  mas: string;
  dateRemitted: string;
  memberNumber: string;
  surname: string;
  firstName: string;
  middleName: string;
  nameExtension: string;
  birthdate: string;
  birthplace: string;
  gender: string;
  age: string;
  civilStatus: string;
  contactNumber: string;
  addressHouse: string;
  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: string;
  claimantAddressHouse: string;
  programId: string;
  doi: string;
  /** HH:MM, the time of the DOI. */
  doiTime?: string;
  paymentMethod: string;
  registrationFee: string;
  registrationAmount: string;
  amountPaid: string;
  programTerms: string;
  applicationNo: string;
  orNumber: string;
  orDate: string;
  /** Why an application date more than a day old was encoded late. */
  backdateReason?: string;
  /** Why the Date Remitted is not the day the MAS was cleared. */
  dateRemittedReason?: string;
};

/**
 * Saves a New Sale. The cash it brings in is owed by the accountable MAS until a New Sales remittance covers it, so
 * each sale starts Outstanding. A batch's remittance penalty, and its Fidelity in `quote`, are passed for the batch's
 * first sale only.
 */
export async function addSale(
  sale: SaleSheetData,
  accountableEmployeeId: string,
  penalty: { amount: number; note: string } = { amount: 0, note: "" },
  quote: { incentive: number; remittance: number; fidelity: number; forfeited?: number; noIncentiveReason?: string },
) {
  await currentDb().insert(sales).values({
    sale_id: sale.saleId, date_created: optional(sale.dateCreated), branch: optional(sale.branch), mas: optional(sale.mas), date_remitted: optionalDate(sale.dateRemitted),
    member_number: optional(sale.memberNumber), ...memberColumns(sale), program_id: text(sale.programId), doi: optionalDate(sale.doi), doi_time: optional(sale.doiTime),
    payment_method: optional(sale.paymentMethod), registration_fee: yes(sale.registrationFee), registration_amount: optionalMoney(sale.registrationAmount),
    amount_paid: optionalMoney(sale.amountPaid), notes: optional(sale.programTerms), application_no: optional(sale.applicationNo), or_number: optional(sale.orNumber),
    or_date: optionalDate(sale.orDate), ...encoded(), remittance_status: "Outstanding", accountable_employee_id: accountableEmployeeId,
    penalty_amount: penalty.amount > 0 ? penalty.amount : null, penalty_note: penalty.amount > 0 ? penalty.note : null,
    mas_incentive: quote.incentive, remittance_amount: quote.remittance, fidelity_amount: quote.fidelity > 0 ? quote.fidelity : null,
    backdate_reason: optional(sale.backdateReason), date_remitted_reason: optional(sale.dateRemittedReason),
    // No incentive (owner, October 20, 2026): the incentive it would have earned is kept as forfeited.
    forfeited_incentive: quote.forfeited && quote.forfeited > 0 ? quote.forfeited : null, no_incentive_reason: optional(quote.noIncentiveReason),
  });
}

/** Members with an account in this branch (and with this MAS when given), for the MAM member dropdown: ID, number, name. */
export async function listMembersInBranch(branch: string, mas = "") {
  const normalizedBranch = text(branch).toLowerCase(), normalizedMas = text(mas).toLowerCase();
  if (!normalizedBranch) return [];
  // Explicit alias and table name: see findMembers.
  const rows = await currentDb().select({ id: members.member_id, number: members.member_number, surname: members.surname, firstName: members.first_name, middleName: members.middle_name })
    .from(members)
    .where(sql`exists (select 1 from member_programs mp where mp.member_id = "members"."member_id" and lower(trim(mp.branch)) = ${normalizedBranch}${normalizedMas ? sql` and lower(trim(mp.mas)) = ${normalizedMas}` : sql``})`)
    .orderBy(asc(members.surname), asc(members.first_name), asc(members.member_number))
    .limit(5000);
  return rows.map((row) => ({ id: row.id, number: row.number, name: `${row.surname}, ${[row.firstName, row.middleName].filter(Boolean).join(" ")}`.trim() }));
}

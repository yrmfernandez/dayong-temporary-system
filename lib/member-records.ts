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

const memberColumns = (details: MemberDetails) => ({
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

async function findMembers(search: string, branch: string, mas: string, limit: number) {
  const term = text(search).toLowerCase();
  const normalizedBranch = text(branch).toLowerCase(), normalizedMas = text(mas).toLowerCase();
  const scoped = Boolean(normalizedBranch || normalizedMas);
  if ((!term && !scoped) || (scoped && (!normalizedBranch || !normalizedMas))) return [];
  // Written with an explicit alias (mp) and table name: inside a subquery, Drizzle's column references are not
  // table-qualified, and an unqualified member_id would compare the enrollment with itself instead of with the member.
  const eligible = scoped
    ? sql`lower(trim(mp.branch)) = ${normalizedBranch} and lower(trim(mp.mas)) = ${normalizedMas} and (coalesce(trim(mp.status), '') = '' or lower(trim(mp.status)) = 'active')`
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
  return rows.map(({ member: row, programIds: ids }) => ({
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
  }));
}

export type MemberProgramSheetData = {
  enrollmentId: string;
  memberId: string;
  memberNumber: string;
  programId: string;
  doi: string;
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
    doi: optionalDate(enrollment.doi), branch: optional(enrollment.branch), mas: optional(enrollment.mas), remittance_method: optional(enrollment.paymentMethod),
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
  quote: { incentive: number; remittance: number; fidelity: number },
) {
  await currentDb().insert(sales).values({
    sale_id: sale.saleId, date_created: optional(sale.dateCreated), branch: optional(sale.branch), mas: optional(sale.mas), date_remitted: optionalDate(sale.dateRemitted),
    member_number: optional(sale.memberNumber), ...memberColumns(sale), program_id: text(sale.programId), doi: optionalDate(sale.doi),
    payment_method: optional(sale.paymentMethod), registration_fee: yes(sale.registrationFee), registration_amount: optionalMoney(sale.registrationAmount),
    amount_paid: optionalMoney(sale.amountPaid), notes: optional(sale.programTerms), application_no: optional(sale.applicationNo), or_number: optional(sale.orNumber),
    or_date: optionalDate(sale.orDate), ...encoded(), remittance_status: "Outstanding", accountable_employee_id: accountableEmployeeId,
    penalty_amount: penalty.amount > 0 ? penalty.amount : null, penalty_note: penalty.amount > 0 ? penalty.note : null,
    mas_incentive: quote.incentive, remittance_amount: quote.remittance, fidelity_amount: quote.fidelity > 0 ? quote.fidelity : null,
    backdate_reason: optional(sale.backdateReason),
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

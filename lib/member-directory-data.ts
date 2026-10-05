import { and, eq, inArray, sql } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";
import { buildMemberDirectory, type CollectorRecord, type EnrollmentRecord, type MemberRecord } from "@/lib/member-directory";

const { collections, member_programs: memberPrograms, members, programs } = schema;
const text = (value: string | null | undefined) => (value ?? "").trim();

/**
 * The Members directory from the database. With `onlyMas` (lib/member-scope.ts), only that MAS's program accounts and
 * their members are loaded, so a MAS never receives anyone else's member data.
 */
export async function loadMemberDirectory(onlyMas: string | null = null) {
  const db = currentDb();
  const masCondition = onlyMas === null ? undefined : sql`lower(trim(${memberPrograms.mas})) = ${onlyMas.trim().toLowerCase()}`;
  const enrollmentRows = await db.select().from(memberPrograms).where(masCondition);
  const memberIds = [...new Set(enrollmentRows.map((row) => row.member_id))];
  const [memberRows, programRows, collectorRows] = await Promise.all([
    onlyMas !== null && !memberIds.length ? [] : db.select().from(members).where(onlyMas === null ? undefined : inArray(members.member_id, memberIds)),
    db.select({ id: programs.program_id, name: programs.program_name, code: programs.program_code }).from(programs),
    // The latest posted Collector collection per member number and program (the directory shows that Collector).
    db.selectDistinctOn([collections.member_number, collections.program_id], {
      memberNumber: collections.member_number, programId: collections.program_id, date: collections.or_date, person: collections.accountable_name,
    }).from(collections)
      .where(and(eq(collections.status, "Posted"), eq(collections.collected_by_role, "Collector"), sql`coalesce(trim(${collections.accountable_name}), '') <> ''`,
        onlyMas === null ? undefined : (memberIds.length ? inArray(collections.member_id, memberIds) : sql`false`)))
      .orderBy(collections.member_number, collections.program_id, sql`${collections.or_date} desc nulls last`),
  ]);
  const memberRecords: MemberRecord[] = memberRows.map((row) => ({
    id: row.member_id, number: row.member_number, surname: text(row.surname), firstName: text(row.first_name), middleName: text(row.middle_name), nameExtension: text(row.name_extension),
    birthdate: row.birthdate ?? "", birthplace: text(row.birthplace), gender: text(row.gender), civilStatus: text(row.civil_status), contact: text(row.member_contact),
    address: text(row.address), status: text(row.status), claimant: text(row.claimant_name), claimantContact: text(row.claimant_contact),
    claimantSameAddress: row.claimant_same_address, claimantAddress: text(row.claimant_address),
  }));
  const enrollmentRecords: EnrollmentRecord[] = enrollmentRows.map((row) => ({
    id: row.enrollment_id, memberId: row.member_id, memberNumber: text(row.member_number), programId: row.program_id, doi: row.doi ?? "",
    branch: text(row.branch), mas: text(row.mas), paymentMethod: text(row.remittance_method), status: text(row.status),
  }));
  const programNames = Object.fromEntries(programRows.map((row) => [row.id, text(row.name) || text(row.code)]));
  const collectorRecords: CollectorRecord[] = collectorRows.map((row) => ({ memberNumber: text(row.memberNumber), programId: row.programId, date: row.date ?? "", person: text(row.person) }));
  return buildMemberDirectory(memberRecords, enrollmentRecords, programNames, collectorRecords);
}

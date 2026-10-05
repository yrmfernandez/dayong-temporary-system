import { and, eq, inArray, sql } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";
import { accountReport } from "@/lib/account-data";
import { buildMemberDirectory, emptyDirectoryFilters, filterMemberDirectory, matchesStanding, type CollectorRecord, type DirectoryFilters, type DirectoryMember, type EnrollmentRecord, type MemberRecord } from "@/lib/member-directory";
import { isOwnAccount } from "@/lib/member-scope";

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

export type DirectoryQuery = {
  filters: DirectoryFilters;
  sort: "name" | "number" | "status";
  descending: boolean;
  page: number;
  pageSize: number;
  onlyMas: string | null;
};

/**
 * One page of the Members directory, filtered and sorted on the server. Payment statuses (today's MAM rules) are worked
 * out only for the members on the page, and for the payment-status and Forfeited filters only for the members the
 * other filters leave, so the page never loads every payment just to show 25 members.
 */
export async function queryMemberDirectory(query: DirectoryQuery) {
  const everyone = await loadMemberDirectory(query.onlyMas);
  // A MAS sees only their own programs on each member.
  const members = query.onlyMas === null ? everyone : everyone
    .map((member) => ({ ...member, enrollments: member.enrollments.filter((enrollment) => isOwnAccount(enrollment.mas, query.onlyMas ?? "")) }))
    .filter((member) => member.enrollments.length > 0);
  const enrollments = members.flatMap((member) => member.enrollments);
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort();
  const options = {
    branches: unique(enrollments.map((enrollment) => enrollment.branch)),
    mas: unique(enrollments.flatMap((enrollment) => [enrollment.mas, enrollment.collector])),
    programs: [...new Map(enrollments.map((enrollment) => [enrollment.programId, enrollment.programName])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    statuses: unique(members.map((member) => member.status)),
  };
  const counts = Object.fromEntries([["", members.length], ...(["active", "inactive", "dead", "alive"] as const).map((standing) => [standing, members.filter((member) => matchesStanding(member, standing)).length])]);

  const needsStatus = Boolean(query.filters.accountStatus) || query.filters.standing === "forfeited";
  let statusWarning = "";
  // Every filter except the ones that need today's payment status.
  let matched = filterMemberDirectory(members, { ...query.filters, accountStatus: "", standing: query.filters.standing === "forfeited" ? "" : query.filters.standing });
  if (needsStatus) {
    statusWarning = await applyStatuses(matched);
    matched = filterMemberDirectory(matched, { ...emptyDirectoryFilters, branch: query.filters.branch, mas: query.filters.mas, program: query.filters.program, accountStatus: query.filters.accountStatus, standing: query.filters.standing === "forfeited" ? "forfeited" : "" });
  }
  const key = query.sort;
  matched.sort((a, b) => (a[key].localeCompare(b[key], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (query.descending ? -1 : 1));
  const pages = Math.max(1, Math.ceil(matched.length / query.pageSize));
  const page = Math.min(Math.max(1, query.page), pages);
  const visible = matched.slice((page - 1) * query.pageSize, page * query.pageSize);
  if (!needsStatus) statusWarning = await applyStatuses(visible);
  if (needsStatus) counts.forfeited = query.filters.standing === "forfeited" ? matched.length : counts.forfeited;
  return { members: visible, total: members.length, matched: matched.length, page, pages, counts, options, statusWarning };
}

/** Sets today's payment status on each enrollment of these members. Returns a warning when it could not be worked out. */
async function applyStatuses(members: DirectoryMember[]) {
  const ids = members.flatMap((member) => member.enrollments.map((enrollment) => enrollment.id));
  if (!ids.length) return "";
  try {
    const report = await accountReport({ enrollmentIds: ids });
    const accounts = new Map(report.rows.map((row) => [row.id, row]));
    for (const member of members) for (const enrollment of member.enrollments) {
      const account = accounts.get(enrollment.id);
      enrollment.accountStatus = account && "status" in account ? account.status : account?.error ? "Needs review" : "Not started";
      enrollment.temporarilySuspended = account && "temporarilySuspended" in account ? account.temporarilySuspended : false;
      enrollment.accountError = account?.error;
    }
    return "";
  } catch {
    for (const member of members) for (const enrollment of member.enrollments) enrollment.accountStatus = "Needs review";
    return "Payment statuses could not be calculated. Check MAM or refresh to retry.";
  }
}

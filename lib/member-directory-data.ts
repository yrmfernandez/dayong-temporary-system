import { and, eq, sql, type AnyColumn, type SQL } from "drizzle-orm";

import { currentDb, schema } from "@/lib/db";
import { accountReport } from "@/lib/account-data";
import { DEACTIVATED, isDeactivated } from "@/lib/account-deactivation";
import { buildMemberDirectory, DECEASED_STATUS, emptyDirectoryFilters, filterMemberDirectory, type CollectorRecord, type DirectoryFilters, type DirectoryMember, type EnrollmentRecord, type MemberRecord } from "@/lib/member-directory";
import { getEmployees } from "@/lib/employees";
import { getBranches } from "@/lib/google-sheets-data";
import { shortCached } from "@/lib/short-cache";

const { collections, member_programs: memberPrograms, members, programs } = schema;
const text = (value: string | null | undefined) => (value ?? "").trim();

/**
 * Only the columns the directory shows (October 31, 2026): reading whole rows sent about 7.5 MB from the database on every
 * Members page, filter or page change, a large share of the Supabase egress; these columns are about half of that.
 */
const enrollmentColumns = {
  enrollment_id: memberPrograms.enrollment_id, member_id: memberPrograms.member_id, member_number: memberPrograms.member_number, program_id: memberPrograms.program_id,
  doi: memberPrograms.doi, doi_time: memberPrograms.doi_time, branch: memberPrograms.branch, mas: memberPrograms.mas, remittance_method: memberPrograms.remittance_method,
  status: memberPrograms.status, deactivated_on: memberPrograms.deactivated_on, fully_paid_on: memberPrograms.fully_paid_on, account_status: memberPrograms.account_status,
};
const memberColumns = {
  member_id: members.member_id, member_number: members.member_number, surname: members.surname, first_name: members.first_name, middle_name: members.middle_name,
  name_extension: members.name_extension, birthdate: members.birthdate, birthplace: members.birthplace, gender: members.gender, civil_status: members.civil_status,
  member_contact: members.member_contact, address: members.address, status: members.status, claimant_name: members.claimant_name, claimant_contact: members.claimant_contact,
  claimant_same_address: members.claimant_same_address, claimant_address: members.claimant_address, died_on: members.died_on,
};

const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
/** One parameter however many IDs: a Status filter can leave every member. */
const oneOf = (column: AnyColumn, ids: string[]) => sql`${column} in (select jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))`;

/**
 * The accounts (with their latest Collector) and members the directory works on, as SQL, so filters, counts and paging
 * run in the database. Reading every member and account for each load was half of all rows the database sent, about
 * 4.4 MB a load (production pg_stat_statements, November 5, 2026). Matches memberStanding and buildMemberDirectory in
 * lib/member-directory.ts. A MAS's accounts only with `onlyMas`, and only members who have one. `collectors` adds each
 * account's latest Collector, which only the MAS filter and its choices need.
 */
function directoryTables(onlyMas: string | null, collectors: boolean) {
  return sql`
    with latest_collector as (
      select distinct on (member_number, program_id) trim(member_number) as member_number, program_id, trim(accountable_name) as person
      from collections
      where status = 'Posted' and collected_by_role = 'Collector' and coalesce(trim(accountable_name), '') <> ''
      order by member_number, program_id, or_date desc nulls last
    ), accounts as (
      select mp.member_id, mp.program_id, coalesce(trim(mp.branch), '') as branch, coalesce(trim(mp.mas), '') as mas, ${collectors ? sql`coalesce(lc.person, '')` : sql`''`} as collector,
        coalesce(nullif(trim(p.program_name), ''), nullif(trim(p.program_code), ''), mp.program_id) as program_name,
        mp.doi::text as doi, mp.deactivated_on::text as dropped, mp.fully_paid_on::text as fully_paid,
        lower(coalesce(trim(mp.status), '')) = 'deactivated' as deactivated,
        lower(coalesce(trim(mp.status), '')) = 'deactivated' or mp.fully_paid_on is not null or lower(coalesce(trim(mp.account_status), '')) in ('forfeited', 'fully paid') as ended
      from member_programs mp
      join members m on m.member_id = mp.member_id
      left join programs p on p.program_id = mp.program_id
      ${collectors ? sql`left join latest_collector lc on lc.member_number = coalesce(nullif(m.member_number, ''), trim(mp.member_number)) and lc.program_id = mp.program_id` : sql``}
      where ${onlyMas === null ? sql`true` : sql`lower(trim(mp.mas)) = ${onlyMas.toLowerCase()}`}
    ), account_totals as (
      select member_id, bool_and(ended) as all_ended, bool_or(deactivated) as any_deactivated from accounts group by member_id
    ), named as (
      select m.*, concat_ws(', ', nullif(trim(m.surname), ''), nullif(concat_ws(' ', nullif(trim(m.first_name), ''), nullif(trim(m.middle_name), ''), nullif(trim(m.name_extension), '')), '')) as name,
        lower(coalesce(trim(m.status), '')) = 'deceased' as deceased
      from members m
    ), people as (
      select n.member_id, n.member_number as number, n.name, n.deceased, n.died_on::text as died_on, coalesce(t.any_deactivated, false) as any_deactivated,
        case when n.deceased then ${DECEASED_STATUS} when coalesce(t.all_ended, true) then 'Inactive' else 'Active' end as status,
        lower(concat_ws(' ', n.name, n.member_number, trim(n.member_contact), trim(n.address))) as searchable
      from named n
      left join account_totals t on t.member_id = n.member_id
      where ${onlyMas === null ? sql`true` : sql`t.member_id is not null`}
    )`;
}

/** filterMemberDirectory as a condition on `people p`, for every filter but today's payment status; null when none is set. */
function directoryCondition(filters: DirectoryFilters) {
  const dated = filters.dateField && (filters.dateFrom || filters.dateTo) ? filters.dateField : "";
  const inRange = (value: SQL) => sql.join([sql`${value} is not null`, ...(filters.dateFrom ? [sql`${value} >= ${filters.dateFrom}`] : []), ...(filters.dateTo ? [sql`${value} <= ${filters.dateTo}`] : [])], sql` and `);
  const accountDate = ({ doi: sql`a.doi`, dropped: sql`a.dropped`, fullyPaid: sql`a.fully_paid` } as Record<string, SQL>)[dated];
  // A program's date is matched on the same program as the other filters (e.g. NS in this date in this branch).
  const onAccount = [
    ...(accountDate ? [inRange(accountDate)] : []),
    ...(filters.branch ? [sql`a.branch = ${filters.branch}`] : []),
    ...(filters.mas ? [sql`(a.mas = ${filters.mas} or a.collector = ${filters.mas})`] : []),
    ...(filters.program ? [sql`a.program_id = ${filters.program}`] : []),
  ];
  const standing: Record<string, SQL> = {
    dead: sql`p.deceased`, alive: sql`not p.deceased`, active: sql`p.status = 'Active'`, inactive: sql`p.status = 'Inactive'`, deactivated: sql`p.any_deactivated`,
  };
  const conditions = [
    ...filters.search.toLowerCase().trim().split(/\s+/).filter(Boolean).map((term) => sql`strpos(p.searchable, lower(${term})) > 0`),
    ...(filters.status ? [sql`p.status = ${filters.status}`] : []),
    ...(standing[filters.standing] ? [standing[filters.standing]] : []),
    ...(dated === "died" ? [inRange(sql`p.died_on`)] : []),
    ...(onAccount.length ? [sql`exists (select 1 from accounts a where a.member_id = p.member_id and ${sql.join(onAccount, sql` and `)})`] : []),
  ];
  return conditions.length ? sql.join(conditions, sql` and `) : null;
}

/**
 * The totals and filter choices depend only on the records, not on the page or filters, and were most of the database's
 * work for a load (about 300 of 320 ms on staging), so they are kept for 15 s in this server; a save here clears them.
 */
function directorySummary(onlyMas: string | null) {
  return shortCached(`member-directory:${onlyMas === null ? "all" : `mas:${onlyMas}`}`, 15_000, async () => {
    const db = currentDb();
    const [totalRows, optionRows] = await Promise.all([
      db.execute(sql`${directoryTables(onlyMas, false)} select count(*)::int as total,
        (count(*) filter (where p.status = 'Active'))::int as active, (count(*) filter (where p.status = 'Inactive'))::int as inactive,
        (count(*) filter (where p.any_deactivated))::int as deactivated, (count(*) filter (where p.deceased))::int as dead, (count(*) filter (where not p.deceased))::int as alive
        from people p`),
      db.execute(sql`${directoryTables(onlyMas, true)}
        select 'branch' as kind, branch as value, '' as label from accounts union select 'mas', mas, '' from accounts union select 'mas', collector, '' from accounts
        union select 'program', program_id, program_name from accounts union select 'status', status, '' from people`),
    ]);
    return {
      totals: rowsOf<{ total: number; active: number; inactive: number; deactivated: number; dead: number; alive: number }>(totalRows)[0],
      choices: rowsOf<{ kind: string; value: string; label: string }>(optionRows),
    };
  });
}

/** These members as the directory shows them; a MAS gets only their own programs. Sorted by name. */
async function readMembers(ids: string[], onlyMas: string | null) {
  if (!ids.length) return [];
  const db = currentDb();
  const masCondition = onlyMas === null ? undefined : sql`lower(trim(${memberPrograms.mas})) = ${onlyMas.toLowerCase()}`;
  const [enrollmentRows, memberRows, programRows, collectorRows] = await Promise.all([
    db.select(enrollmentColumns).from(memberPrograms).where(and(oneOf(memberPrograms.member_id, ids), masCondition)).orderBy(memberPrograms.row_seq),
    db.select(memberColumns).from(members).where(oneOf(members.member_id, ids)),
    db.select({ id: programs.program_id, name: programs.program_name, code: programs.program_code }).from(programs),
    // The latest posted Collector collection per member number and program (the directory shows that Collector).
    db.selectDistinctOn([collections.member_number, collections.program_id], {
      memberNumber: collections.member_number, programId: collections.program_id, date: collections.or_date, person: collections.accountable_name,
    }).from(collections)
      .where(and(eq(collections.status, "Posted"), eq(collections.collected_by_role, "Collector"), sql`coalesce(trim(${collections.accountable_name}), '') <> ''`, oneOf(collections.member_id, ids)))
      .orderBy(collections.member_number, collections.program_id, sql`${collections.or_date} desc nulls last`),
  ]);
  const memberRecords: MemberRecord[] = memberRows.map((row) => ({
    id: row.member_id, number: row.member_number, surname: text(row.surname), firstName: text(row.first_name), middleName: text(row.middle_name), nameExtension: text(row.name_extension),
    birthdate: row.birthdate ?? "", birthplace: text(row.birthplace), gender: text(row.gender), civilStatus: text(row.civil_status), contact: text(row.member_contact),
    address: text(row.address), status: text(row.status), claimant: text(row.claimant_name), claimantContact: text(row.claimant_contact),
    claimantSameAddress: row.claimant_same_address, claimantAddress: text(row.claimant_address), diedOn: row.died_on ?? "",
  }));
  const enrollmentRecords: EnrollmentRecord[] = enrollmentRows.map((row) => ({
    id: row.enrollment_id, memberId: row.member_id, memberNumber: text(row.member_number), programId: row.program_id, doi: row.doi ?? "", doiTime: text(row.doi_time).slice(0, 5),
    branch: text(row.branch), mas: text(row.mas), paymentMethod: text(row.remittance_method), status: text(row.status),
    deactivatedOn: row.deactivated_on ?? "", fullyPaidOn: row.fully_paid_on ?? "", storedStatus: text(row.account_status),
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
 * One page of the Members directory, filtered, sorted and paged in the database, so only the members on the page are
 * read. Payment statuses (today's MAM rules) are worked out only for those members. The payment-status and Forfeited
 * filters need them to filter at all, so there the members the other filters leave are read and finished here.
 */
export async function queryMemberDirectory(query: DirectoryQuery) {
  const db = currentDb();
  const tables = directoryTables(query.onlyMas, Boolean(query.filters.mas));
  const needsStatus = Boolean(query.filters.accountStatus) || query.filters.standing === "forfeited";
  // Every filter except the ones that need today's payment status.
  const filter = directoryCondition({ ...query.filters, accountStatus: "", standing: query.filters.standing === "forfeited" ? "" : query.filters.standing });
  const condition = filter ?? sql`true`;
  const [employees, branchList, { totals, choices }, matchedRows] = await Promise.all([
    getEmployees(), getBranches(), directorySummary(query.onlyMas),
    filter && !needsStatus ? db.execute(sql`${tables} select count(*)::int as matched from people p where ${filter}`) : null,
  ]);
  // Branch first: the MAS / Collector choices are the active employees assigned to each branch.
  const branchNames = new Map(branchList.map((branch) => [branch.id, branch.name]));
  const staff = employees.filter((employee) => employee.status === "active").map((employee) => ({ name: employee.name, branches: employee.branchIds.map((id) => branchNames.get(id) ?? "").filter(Boolean) }));
  const unique = (kind: string) => choices.filter((choice) => choice.kind === kind && choice.value).map((choice) => choice.value).sort();
  const options = {
    branches: unique("branch"),
    mas: unique("mas"),
    programs: choices.filter((choice) => choice.kind === "program").map((choice): [string, string] => [choice.value, choice.label]).sort((a, b) => a[1].localeCompare(b[1])),
    statuses: unique("status"),
    staff,
  };
  const counts: Record<string, number> = { "": totals.total, active: totals.active, inactive: totals.inactive, deactivated: totals.deactivated, dead: totals.dead, alive: totals.alive };

  const direction = query.descending ? sql`desc` : sql`asc`;
  const sortKey = { name: sql`lower(p.name)`, number: sql`p.number`, status: sql`p.status` }[query.sort];
  const idsOf = async (limit: SQL) => rowsOf<{ member_id: string }>(await db.execute(sql`${tables} select p.member_id from people p where ${condition} order by ${sortKey} ${direction}, p.member_id ${direction} ${limit}`)).map((row) => row.member_id);

  if (needsStatus) {
    const found = await readMembers(await idsOf(sql``), query.onlyMas);
    const statusWarning = await applyStatuses(found);
    const matched = filterMemberDirectory(found, { ...emptyDirectoryFilters, branch: query.filters.branch, mas: query.filters.mas, program: query.filters.program, accountStatus: query.filters.accountStatus, standing: query.filters.standing === "forfeited" ? "forfeited" : "" });
    const key = query.sort;
    matched.sort((a, b) => (a[key].localeCompare(b[key], undefined, { numeric: true, sensitivity: "base" }) || a.id.localeCompare(b.id)) * (query.descending ? -1 : 1));
    const pages = Math.max(1, Math.ceil(matched.length / query.pageSize));
    const page = Math.min(Math.max(1, query.page), pages);
    if (query.filters.standing === "forfeited") counts.forfeited = matched.length;
    return { members: matched.slice((page - 1) * query.pageSize, page * query.pageSize), total: totals.total, matched: matched.length, page, pages, counts, options, statusWarning };
  }
  const matched = matchedRows ? rowsOf<{ matched: number }>(matchedRows)[0].matched : totals.total;
  const pages = Math.max(1, Math.ceil(matched / query.pageSize));
  const page = Math.min(Math.max(1, query.page), pages);
  const ids = await idsOf(sql`limit ${query.pageSize} offset ${(page - 1) * query.pageSize}`);
  const order = new Map(ids.map((id, index) => [id, index]));
  const visible = (await readMembers(ids, query.onlyMas)).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const statusWarning = await applyStatuses(visible);
  return { members: visible, total: totals.total, matched, page, pages, counts, options, statusWarning };
}

/** Sets today's payment status on each enrollment of these members. Returns a warning when it could not be worked out. */
async function applyStatuses(members: DirectoryMember[]) {
  const ids = members.flatMap((member) => member.enrollments.map((enrollment) => enrollment.id));
  if (!ids.length) return "";
  try {
    const report = await accountReport({ enrollmentIds: ids });
    const accounts = new Map(report.rows.map((row) => [row.id, row]));
    for (const member of members) for (const enrollment of member.enrollments) {
      // A program deactivated for the member has no standing (lib/account-deactivation.ts).
      if (isDeactivated(enrollment.status)) { enrollment.accountStatus = DEACTIVATED; enrollment.temporarilySuspended = false; continue; }
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

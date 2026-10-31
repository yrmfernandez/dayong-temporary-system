export type DirectoryEnrollment = {
  id: string; programId: string; programName: string; branch: string; mas: string;
  /** The Collector on this enrollment's most recent posted Collection brought in by a Collector; blank when none. */
  collector: string;
  doi: string;
  /** HH:MM, the time of the DOI (New Sales since October 19, 2026); blank before. */
  doiTime?: string;
  paymentMethod: string; status: string;
  /** Deactivated (dropped) on, fully paid on, and the stored status (member_programs.account_status): the date filter and Inactive. */
  deactivatedOn?: string; fullyPaidOn?: string; storedStatus?: string;
  accountStatus?: string; temporarilySuspended?: boolean; accountError?: string;
};
export type DirectoryMember = {
  id: string; number: string; name: string; birthdate: string; birthplace: string;
  gender: string; civilStatus: string; contact: string; address: string; status: string;
  claimant: string; claimantContact: string; claimantAddress: string;
  /** Status "Deceased" marks a member who has died; every other status is alive. */
  deceased: boolean;
  /** Date of death, when recorded (an approved Dropout with reason Deceased). */
  diedOn?: string;
  enrollments: DirectoryEnrollment[];
};

export const DECEASED_STATUS = "Deceased";
/**
 * Statuses set by hand (owner, October 31, 2026): Active or Deceased. Inactive is worked out instead (memberStanding):
 * a living member whose every program is dropped (deactivated), forfeited or fully paid, or who has no program.
 */
export const MEMBER_STATUSES = ["Active", DECEASED_STATUS] as const;
const ENDED_STATUSES = new Set(["forfeited", "fully paid"]);
export function memberStanding(deceased: boolean, enrollments: Array<Pick<DirectoryEnrollment, "status" | "storedStatus" | "fullyPaidOn">>) {
  if (deceased) return DECEASED_STATUS;
  const ended = (enrollment: (typeof enrollments)[number]) => enrollment.status.trim().toLowerCase() === "deactivated" || Boolean(enrollment.fullyPaidOn) || ENDED_STATUSES.has((enrollment.storedStatus ?? "").trim().toLowerCase());
  return enrollments.every(ended) ? "Inactive" : "Active";
}

/** Date filters on Members (owner, October 31, 2026): a member-level date in a range. Records by date are in Search Records. */
export const DATE_FILTERS = [["doi", "DOI (New Sale)"], ["dropped", "Dropped (deactivated)"], ["fullyPaid", "Fully paid"], ["died", "Date of death"]] as const;

/** Quick filters on the Members page. Forfeited means at least one program account is forfeited today. */
// Deactivated (owner, October 28, 2026): members with a deactivated account, to find accounts entered by mistake and delete them.
export const STANDING_FILTERS = [["active", "Active"], ["inactive", "Inactive"], ["forfeited", "Forfeited"], ["deactivated", "Deactivated"], ["dead", "Dead"], ["alive", "Alive"]] as const;
export type Standing = (typeof STANDING_FILTERS)[number][0];

export function matchesStanding(member: DirectoryMember, standing: string) {
  const status = member.status.trim().toLowerCase();
  if (standing === "dead") return member.deceased;
  if (standing === "alive") return !member.deceased;
  if (standing === "active") return !member.deceased && status === "active";
  if (standing === "inactive") return !member.deceased && status === "inactive";
  if (standing === "forfeited") return member.enrollments.some((enrollment) => enrollment.accountStatus === "Forfeited");
  if (standing === "deactivated") return member.enrollments.some((enrollment) => enrollment.status.trim().toLowerCase() === "deactivated");
  return true;
}
export type DirectoryFilters = {
  search: string; branch: string; mas: string; program: string;
  status: string; accountStatus: string; standing: string;
  /** One of DATE_FILTERS, with an inclusive YYYY-MM-DD range; either end may be blank. */
  dateField: string; dateFrom: string; dateTo: string;
};
export const emptyDirectoryFilters: DirectoryFilters = {
  search: "", branch: "", mas: "", program: "", status: "", accountStatus: "", standing: "", dateField: "", dateFrom: "", dateTo: "",
};

/** A member as stored (lib/member-directory-data.ts loads these from the database). */
export type MemberRecord = {
  id: string; number: string; surname: string; firstName: string; middleName: string; nameExtension: string;
  birthdate: string; birthplace: string; gender: string; civilStatus: string; contact: string; address: string; status: string;
  claimant: string; claimantContact: string; claimantSameAddress: boolean; claimantAddress: string;
  diedOn?: string;
};
export type EnrollmentRecord = {
  id: string; memberId: string; memberNumber: string; programId: string; doi: string; doiTime?: string; branch: string; mas: string; paymentMethod: string; status: string;
  deactivatedOn?: string; fullyPaidOn?: string; storedStatus?: string;
};
/** A posted Collection brought in by a Collector: who, for which member number and program, on which OR date. */
export type CollectorRecord = { memberNumber: string; programId: string; date: string; person: string };

export function buildMemberDirectory(memberRecords: MemberRecord[], enrollmentRecords: EnrollmentRecord[], programNames: Record<string, string>, collectorRecords: CollectorRecord[] = []): DirectoryMember[] {
  // The Collector shown for an account is the one on its most recent Collector collection.
  const collectors = new Map<string, { date: string; name: string }>();
  for (const record of collectorRecords) {
    if (!record.person) continue;
    const key = `${record.memberNumber}::${record.programId}`;
    const current = collectors.get(key);
    if (!current || record.date >= current.date) collectors.set(key, { date: record.date, name: record.person });
  }
  const numbers = new Map(memberRecords.map((member) => [member.id, member.number]));
  const enrollments = new Map<string, DirectoryEnrollment[]>();
  for (const record of enrollmentRecords) {
    if (!record.id || !record.memberId) continue;
    const list = enrollments.get(record.memberId) ?? [];
    list.push({ id: record.id, programId: record.programId, programName: programNames[record.programId] || record.programId,
      collector: collectors.get(`${numbers.get(record.memberId) || record.memberNumber}::${record.programId}`)?.name ?? "",
      doi: record.doi, doiTime: record.doiTime ?? "", branch: record.branch, mas: record.mas, paymentMethod: record.paymentMethod, status: record.status,
      deactivatedOn: record.deactivatedOn ?? "", fullyPaidOn: record.fullyPaidOn ?? "", storedStatus: record.storedStatus ?? "" });
    enrollments.set(record.memberId, list);
  }
  const members = new Map<string, DirectoryMember>();
  for (const record of memberRecords) {
    if (!record.id) continue;
    if (members.has(record.id)) throw new Error("Duplicate member ID. Review the member records.");
    members.set(record.id, { id: record.id, number: record.number,
      name: [record.surname, [record.firstName, record.middleName, record.nameExtension].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      birthdate: record.birthdate, birthplace: record.birthplace, gender: record.gender, civilStatus: record.civilStatus,
      contact: record.contact, address: record.address,
      // Inactive is worked out from the programs; Deceased is set by hand or by an approved Dropout.
      status: memberStanding(record.status.toLowerCase() === DECEASED_STATUS.toLowerCase(), enrollments.get(record.id) ?? []), diedOn: record.diedOn ?? "",
      claimant: record.claimant, claimantContact: record.claimantContact,
      claimantAddress: record.claimantSameAddress ? record.address : record.claimantAddress,
      deceased: record.status.toLowerCase() === DECEASED_STATUS.toLowerCase(),
      enrollments: enrollments.get(record.id) ?? [] });
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name) || a.number.localeCompare(b.number));
}

const inRange = (value: string | undefined, from: string, to: string) => Boolean(value) && (!from || value!.slice(0, 10) >= from) && (!to || value!.slice(0, 10) <= to);

export function filterMemberDirectory(members: DirectoryMember[], filters: DirectoryFilters) {
  const terms = filters.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const dated = filters.dateField && (filters.dateFrom || filters.dateTo) ? filters.dateField : "";
  const accountDate = ({ doi: "doi", dropped: "deactivatedOn", fullyPaid: "fullyPaidOn" } as const)[dated as "doi" | "dropped" | "fullyPaid"];
  return members.filter((member) => {
    const searchable = `${member.name} ${member.number} ${member.contact} ${member.address}`.toLowerCase();
    return terms.every((term) => searchable.includes(term))
      && (!filters.status || member.status === filters.status)
      && (!filters.standing || matchesStanding(member, filters.standing))
      && (dated !== "died" || inRange(member.diedOn, filters.dateFrom, filters.dateTo))
      // A program's date is matched on the same program as the other filters (e.g. NS in this date in this branch).
      && (!(filters.branch || filters.mas || filters.program || filters.accountStatus || accountDate) || member.enrollments.some((enrollment) =>
        (!accountDate || inRange(enrollment[accountDate], filters.dateFrom, filters.dateTo))
        && (!filters.branch || enrollment.branch === filters.branch)
        && (!filters.mas || enrollment.mas === filters.mas || enrollment.collector === filters.mas)
        && (!filters.program || enrollment.programId === filters.program)
        && (!filters.accountStatus || (filters.accountStatus === "Suspended" ? enrollment.temporarilySuspended : enrollment.accountStatus === filters.accountStatus))));
  });
}

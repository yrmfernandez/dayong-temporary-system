export type DirectoryEnrollment = {
  id: string; programId: string; programName: string; branch: string; mas: string;
  /** The Collector on this enrollment's most recent posted Collection brought in by a Collector; blank when none. */
  collector: string;
  doi: string; paymentMethod: string; status: string;
  accountStatus?: string; temporarilySuspended?: boolean; accountError?: string;
};
export type DirectoryMember = {
  id: string; number: string; name: string; birthdate: string; birthplace: string;
  gender: string; civilStatus: string; contact: string; address: string; status: string;
  claimant: string; claimantContact: string; claimantAddress: string;
  /** Members!R "Deceased" marks a member who has died; every other status is alive. */
  deceased: boolean;
  enrollments: DirectoryEnrollment[];
};

export const DECEASED_STATUS = "Deceased";
export const MEMBER_STATUSES = ["Active", "Inactive", DECEASED_STATUS] as const;

/** Quick filters on the Members page. Forfeited means at least one program account is forfeited today. */
export const STANDING_FILTERS = [["active", "Active"], ["inactive", "Inactive"], ["forfeited", "Forfeited"], ["dead", "Dead"], ["alive", "Alive"]] as const;
export type Standing = (typeof STANDING_FILTERS)[number][0];

export function matchesStanding(member: DirectoryMember, standing: string) {
  const status = member.status.trim().toLowerCase();
  if (standing === "dead") return member.deceased;
  if (standing === "alive") return !member.deceased;
  if (standing === "active") return !member.deceased && status === "active";
  if (standing === "inactive") return !member.deceased && status === "inactive";
  if (standing === "forfeited") return member.enrollments.some((enrollment) => enrollment.accountStatus === "Forfeited");
  return true;
}
export type DirectoryFilters = {
  search: string; branch: string; mas: string; program: string;
  status: string; accountStatus: string; standing: string;
};
export const emptyDirectoryFilters: DirectoryFilters = {
  search: "", branch: "", mas: "", program: "", status: "", accountStatus: "", standing: "",
};

export function buildMemberDirectory(memberRows: unknown[][], enrollmentRows: unknown[][], programRows: unknown[][], collectionRows: unknown[][] = []): DirectoryMember[] {
  const value = (row: unknown[], index: number) => String(row[index] ?? "").trim();
  const programs = new Map(programRows.map((r) => [value(r, 0), value(r, 2) || value(r, 1)]));
  // Collections: E member number, F program, J OR date, T posting status, Z collected by, AF accountable person.
  const collectors = new Map<string, { date: string; name: string }>();
  for (const row of collectionRows) {
    if (value(row, 19).toLowerCase() !== "posted" || value(row, 25) !== "Collector" || !value(row, 31)) continue;
    const key = `${value(row, 4)}::${value(row, 5)}`;
    const current = collectors.get(key);
    if (!current || value(row, 9) >= current.date) collectors.set(key, { date: value(row, 9), name: value(row, 31) });
  }
  const numbers = new Map(memberRows.map((row) => [value(row, 0), value(row, 1)]));
  const enrollments = new Map<string, DirectoryEnrollment[]>();
  for (const row of enrollmentRows) {
    if (!value(row, 0) || !value(row, 1)) continue;
    const memberId = value(row, 1);
    const list = enrollments.get(memberId) ?? [];
    list.push({ id: value(row, 0), programId: value(row, 3), programName: programs.get(value(row, 3)) || value(row, 3),
      collector: collectors.get(`${numbers.get(memberId) || value(row, 2)}::${value(row, 3)}`)?.name ?? "",
      doi: value(row, 4), branch: value(row, 5), mas: value(row, 6), paymentMethod: value(row, 7), status: value(row, 12) });
    enrollments.set(memberId, list);
  }
  const members = new Map<string, DirectoryMember>();
  for (const row of memberRows) {
    const id = value(row, 0);
    if (!id) continue;
    if (members.has(id)) throw new Error("Duplicate member ID. Review the Members sheet.");
    members.set(id, { id, number: value(row, 1),
      name: [value(row, 2), [value(row, 3), value(row, 4), value(row, 5)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      birthdate: value(row, 6), birthplace: value(row, 7), gender: value(row, 8), civilStatus: value(row, 10),
      // Members!A:R: address is one complete line (M); claimant name, contact, same-address flag and address follow (N:Q); status is R.
      contact: value(row, 11), address: value(row, 12), status: value(row, 17),
      claimant: value(row, 13), claimantContact: value(row, 14),
      claimantAddress: ["true", "yes"].includes(value(row, 15).toLowerCase()) ? value(row, 12) : value(row, 16),
      deceased: value(row, 17).toLowerCase() === DECEASED_STATUS.toLowerCase(),
      enrollments: enrollments.get(id) ?? [] });
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name) || a.number.localeCompare(b.number));
}

export function filterMemberDirectory(members: DirectoryMember[], filters: DirectoryFilters) {
  const terms = filters.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return members.filter((member) => {
    const searchable = `${member.name} ${member.number} ${member.contact} ${member.address}`.toLowerCase();
    return terms.every((term) => searchable.includes(term))
      && (!filters.status || member.status === filters.status)
      && (!filters.standing || matchesStanding(member, filters.standing))
      && (!(filters.branch || filters.mas || filters.program || filters.accountStatus) || member.enrollments.some((enrollment) =>
        (!filters.branch || enrollment.branch === filters.branch)
        && (!filters.mas || enrollment.mas === filters.mas || enrollment.collector === filters.mas)
        && (!filters.program || enrollment.programId === filters.program)
        && (!filters.accountStatus || (filters.accountStatus === "Suspended" ? enrollment.temporarilySuspended : enrollment.accountStatus === filters.accountStatus))));
  });
}

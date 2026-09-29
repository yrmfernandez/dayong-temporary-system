export type DirectoryEnrollment = {
  id: string; programId: string; programName: string; branch: string; mas: string;
  doi: string; paymentMethod: string; status: string;
  accountStatus?: string; temporarilySuspended?: boolean; accountError?: string;
};
export type DirectoryMember = {
  id: string; number: string; name: string; birthdate: string; birthplace: string;
  gender: string; civilStatus: string; contact: string; address: string; status: string;
  claimant: string; claimantContact: string; claimantAddress: string;
  enrollments: DirectoryEnrollment[];
};
export type DirectoryFilters = {
  search: string; branch: string; mas: string; program: string;
  status: string; accountStatus: string;
};
export const emptyDirectoryFilters: DirectoryFilters = {
  search: "", branch: "", mas: "", program: "", status: "", accountStatus: "",
};

export function buildMemberDirectory(memberRows: unknown[][], enrollmentRows: unknown[][], programRows: unknown[][]): DirectoryMember[] {
  const value = (row: unknown[], index: number) => String(row[index] ?? "").trim();
  const programs = new Map(programRows.map((r) => [value(r, 0), value(r, 2) || value(r, 1)]));
  const enrollments = new Map<string, DirectoryEnrollment[]>();
  for (const row of enrollmentRows) {
    if (!value(row, 0) || !value(row, 1)) continue;
    const memberId = value(row, 1);
    const list = enrollments.get(memberId) ?? [];
    list.push({ id: value(row, 0), programId: value(row, 3), programName: programs.get(value(row, 3)) || value(row, 3),
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
      enrollments: enrollments.get(id) ?? [] });
  }
  return [...members.values()].sort((a, b) => a.name.localeCompare(b.name) || a.number.localeCompare(b.number));
}

export function filterMemberDirectory(members: DirectoryMember[], filters: DirectoryFilters) {
  const terms = filters.search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return members.filter((member) => {
    const searchable = `${member.name} ${member.number} ${member.contact}`.toLowerCase();
    return terms.every((term) => searchable.includes(term))
      && (!filters.status || member.status === filters.status)
      && (!(filters.branch || filters.mas || filters.program || filters.accountStatus) || member.enrollments.some((enrollment) =>
        (!filters.branch || enrollment.branch === filters.branch)
        && (!filters.mas || enrollment.mas === filters.mas)
        && (!filters.program || enrollment.programId === filters.program)
        && (!filters.accountStatus || (filters.accountStatus === "Suspended" ? enrollment.temporarilySuspended : enrollment.accountStatus === filters.accountStatus))));
  });
}

import type { Member, ProgramEnrollment } from "./types";

export function getMemberPrograms(
  memberId: string,
  programs: ProgramEnrollment[],
): ProgramEnrollment[] {
  return programs.filter(
    (program) => program.memberId === memberId,
  );
}

export function getProgram(
  programId: string,
  programs: ProgramEnrollment[],
): ProgramEnrollment | undefined {
  return programs.find(
    (program) => program.id === programId,
  );
}

export function getMember(
  memberId: string,
  members: Member[],
): Member | undefined {
  return members.find(
    (member) => member.id === memberId,
  );
}
import { getPrograms } from "./google-sheets-data";

/**
 * Program type used by the application.
 *
 * Program data comes from Google Sheets.
 */
export type Program = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  status: "active" | "inactive";
  description: string;

  incentiveTiers?: {
    id: string;
    programId: string;
    role: "MAS" | "Collector";
    fromMonth: number;
    toMonth: number;
    incentiveType: "fixed" | "percentage";
    markUp: number;
    incentiveAmount: number;
  }[];
};

/**
 * Get all active programs from Google Sheets.
 *
 * This replaces the old hardcoded:
 *
 * export const programs = [...]
 *
 * The actual data now comes from:
 *
 * Google Sheets → Programs
 */
export async function getActivePrograms(): Promise<
  Program[]
> {
  const programs = await getPrograms();

  return programs
    .filter(
      (program) =>
        program.status === "active",
    )
    .map((program) => ({
      id: program.id,
      code: program.code,
      name: program.name,
      basePay: program.basePay,
      status: program.status,
      description: program.description,
      incentiveTiers:
        program.incentiveTiers ?? [],
    }));
}

/**
 * Get all programs from Google Sheets.
 *
 * Use this when the page needs both
 * active and inactive programs.
 */
export async function getAllPrograms(): Promise<
  Program[]
> {
  const programs = await getPrograms();

  return programs.map((program) => ({
    id: program.id,
    code: program.code,
    name: program.name,
    basePay: program.basePay,
    status: program.status,
    description: program.description,
    incentiveTiers:
      program.incentiveTiers ?? [],
  }));
}
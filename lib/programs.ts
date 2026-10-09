import { getPrograms } from "./google-sheets-data";

/**
 * Program type used by the application.
 *
 * Program data comes from the database (programs table).
 */
export type Program = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  status: "active" | "inactive";
  description: string;
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
  flexible?: boolean;
  maxMonthlyPayment?: number | null;
  ageRestricted: boolean;
  minAge: number | null;
  maxAge: number | null;

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
 * Get all active programs.
 *
 * This replaces the old hardcoded:
 *
 * export const programs = [...]
 *
 * The actual data now comes from:
 *
 * Programs table
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
      registrationFeeRequired: program.registrationFeeRequired,
      registrationAmount: program.registrationAmount,
      payBalanceTotal: program.payBalanceTotal,
      flexible: program.flexible,
      maxMonthlyPayment: program.maxMonthlyPayment,
      ageRestricted: program.ageRestricted,
      minAge: program.minAge,
      maxAge: program.maxAge,
      incentiveTiers:
        program.incentiveTiers ?? [],
    }));
}

/**
 * Get all programs.
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
    registrationFeeRequired: program.registrationFeeRequired,
    registrationAmount: program.registrationAmount,
    payBalanceTotal: program.payBalanceTotal,
    flexible: program.flexible,
    maxMonthlyPayment: program.maxMonthlyPayment,
    ageRestricted: program.ageRestricted,
    minAge: program.minAge,
    maxAge: program.maxAge,
    incentiveTiers:
      program.incentiveTiers ?? [],
  }));
}

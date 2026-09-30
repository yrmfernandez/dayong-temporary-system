import { createReadableId } from "@/lib/readable-id";
import { getEmployees } from "@/lib/employees";
import { EMPLOYEE_ID_FORMAT_MESSAGE, isEmployeeIdFormat } from "@/lib/employee-id";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEncoder } from "@/lib/encoder-context";
import { encoderHeaders } from "@/lib/encoder-schema";
import { parsePageAccess } from "@/lib/roles";
import { ageRestrictionCells, normalizeAgeRestriction, readAgeRestriction, type AgeRestriction } from "@/lib/program-age";
import { normalizeSaleIncentive } from "@/lib/remittance";

/** Programs!Q:R cells for the New Sale incentive (blank unless the program has a registration fee). */
const saleIncentiveCells = (data: { registrationFeeRequired?: unknown; registrationAmount?: unknown; saleIncentiveType?: unknown; saleIncentiveAmount?: unknown }) => {
  const setting = normalizeSaleIncentive(data);
  return [setting.saleIncentiveType, setting.saleIncentiveType ? setting.saleIncentiveAmount : ""];
};
import { assertUsernameColumnRemoved, loadUsers, readUserRows, USERS_RANGE } from "@/lib/users-sheet";
import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

const SALES_SHEET = "Sales";
const MEMBERS_SHEET = "Members";
const MEMBER_PROGRAMS_SHEET = "Member programs";
const PROGRAMS_SHEET = "Programs";
const BRANCHES_SHEET = "Branches";
const PROGRAM_INCENTIVES_SHEET =
  "Program Incentives";
const REMITTANCES_SHEET = "Remittances";
const COLLECTIONS_SHEET = "Collections";

/* =========================================================
   MEMBER
========================================================= */

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

export async function addMember(
  member: MemberSheetData,
) {
  const values = [
    member.memberId,
    member.memberNumber,

    member.surname,
    member.firstName,
    member.middleName,
    member.nameExtension,

    member.birthdate,
    member.birthplace,
    member.gender,
    member.age,
    member.civilStatus,
    member.contactNumber,

    member.addressHouse,

    member.claimantName,
    member.claimantContact,
    member.claimantSameAsMember,

    member.claimantAddressHouse,

    member.status,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBERS_SHEET}!A:R`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

  return response.data;
}

export async function addBeneficiaries(
  memberId: string,
  saleId: string,
  beneficiaries: Array<{ id?: string; surname: string; firstName: string; middleName: string; birthdate: string; age: number | null; relationship: string }>,
) {
  if (!beneficiaries.length) return;
  await appendEncodedRows({
    range: "'Beneficiaries'!A:I",
    requestBody: {
      values: beneficiaries.map((item) => [
        createReadableId("BEN"), memberId, saleId, item.surname.trim(),
        item.firstName.trim(), item.middleName.trim(), item.birthdate,
        Number(item.age) || 0, item.relationship.trim(),
      ]),
    },
  });
}

export async function findMemberByNumber(
  memberNumber: string,
) {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBERS_SHEET}!A:R`,
    });

  const rows = response.data.values ?? [];

  if (rows.length <= 1) {
    return null;
  }

  const normalizedMemberNumber =
    memberNumber.trim();

  if (!normalizedMemberNumber) {
    return null;
  }

  for (const row of rows.slice(1)) {
    const rowMemberNumber =
      String(row[1] ?? "").trim();

    if (
      rowMemberNumber ===
      normalizedMemberNumber
    ) {
      return {
        memberId: row[0] ?? "",
        memberNumber: row[1] ?? "",
        birthdate: String(row[6] ?? ""),
        surname: row[2] ?? "",
        firstName: row[3] ?? "",
        middleName: row[4] ?? "",
        nameExtension: row[5] ?? "",
      };
    }
  }

  return null;
}

export async function searchMembersByName(
  search: string,
  branch: string,
  mas: string,
) {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: [`${MEMBERS_SHEET}!A:R`, `'${MEMBER_PROGRAMS_SHEET}'!A:N`],
  });
  const rows = response.data.valueRanges?.[0]?.values ?? [];
  const enrollments = response.data.valueRanges?.[1]?.values ?? [];

  if (rows.length <= 1) {
    return [];
  }

  const searchTerm =
    search.trim().toLowerCase();

  const normalizedBranch = branch.trim().toLowerCase();
  const normalizedMas = mas.trim().toLowerCase();
  if (!searchTerm || !normalizedBranch || !normalizedMas) {
    return [];
  }

  const eligiblePrograms = new Map<string, Set<string>>();
  for (const row of enrollments.slice(1)) {
    const memberId = String(row[1] ?? "").trim();
    const programId = String(row[3] ?? "").trim();
    const enrollmentBranch = String(row[5] ?? "").trim().toLowerCase();
    const enrollmentMas = String(row[6] ?? "").trim().toLowerCase();
    const status = String(row[12] ?? "").trim().toLowerCase();
    if (!memberId || !programId || enrollmentBranch !== normalizedBranch || enrollmentMas !== normalizedMas || (status && status !== "active")) continue;
    const programs = eligiblePrograms.get(memberId) ?? new Set<string>();
    programs.add(programId);
    eligiblePrograms.set(memberId, programs);
  }

  return rows
    .slice(1)
    .filter((row) => {
      const surname =
        String(row[2] ?? "");

      const firstName =
        String(row[3] ?? "");

      const middleName =
        String(row[4] ?? "");

      const fullName =
        `${firstName} ${middleName} ${surname}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const memberId = String(row[0] ?? "").trim();
      const memberNumber = String(row[1] ?? "").trim().toLowerCase();
      return eligiblePrograms.has(memberId) && (fullName.includes(searchTerm) || memberNumber.includes(searchTerm));
    })
    .slice(0, 5)
    .map((row) => ({
      id: row[0] ?? "",
      phMemberNumber: row[1] ?? "",
      programIds: [...(eligiblePrograms.get(String(row[0] ?? "").trim()) ?? [])],

      name: {
        surname: row[2] ?? "",
        firstName: row[3] ?? "",
        middleName: row[4] ?? "",
        nameExtension: row[5] ?? "",
      },

      birthdate: row[6] ?? "",
      birthplace: row[7] ?? "",
      gender: row[8] ?? "",

      age: row[9]
        ? Number(row[9])
        : null,

      civilStatus: row[10] ?? "",
      contactNumber: row[11] ?? "",

      address: {
        houseBlockLot: row[12] ?? "",
      },

      claimant: {
        completeName: row[13] ?? "",
        contactNumber: row[14] ?? "",

        sameAsMemberAddress: [
          "true",
          "yes",
        ].includes(
          String(row[15] ?? "")
            .trim()
            .toLowerCase(),
        ),

        address: {
          houseBlockLot: row[16] ?? "",
        },
      },
    }));
}

/* =========================================================
   MEMBER PROGRAMS
========================================================= */

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

export async function findMemberProgramEnrollment(
  memberNumber: string,
  programId: string,
) {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBER_PROGRAMS_SHEET}!A:N`,
    });

  const rows = response.data.values ?? [];

  if (rows.length <= 1) {
    return null;
  }

  const normalizedMemberNumber =
    memberNumber.trim();

  const normalizedProgramId =
    programId.trim();

  if (
    !normalizedMemberNumber ||
    !normalizedProgramId
  ) {
    return null;
  }

  for (const row of rows.slice(1)) {
    const rowMemberNumber =
      String(row[2] ?? "").trim();

    const rowProgramId =
      String(row[3] ?? "").trim();

    if (
      rowMemberNumber ===
        normalizedMemberNumber &&
      rowProgramId ===
        normalizedProgramId
    ) {
      return {
        enrollmentId: row[0] ?? "",
        memberId: row[1] ?? "",
        memberNumber: row[2] ?? "",
        programId: row[3] ?? "",
        branch: row[5] ?? "",
        mas: row[6] ?? "",
      };
    }
  }

  return null;
}

export async function addMemberProgram(
  enrollment: MemberProgramSheetData,
) {
  const values = [
    enrollment.enrollmentId,
    enrollment.memberId,
    enrollment.memberNumber,
    enrollment.programId,
    enrollment.doi,
    enrollment.branch,
    enrollment.mas,
    enrollment.paymentMethod,
    enrollment.registrationFee,
    enrollment.registrationAmount,
    enrollment.amountPaid,
    enrollment.programTerms,
    enrollment.status,
    enrollment.dateCreated,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBER_PROGRAMS_SHEET}!A:N`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

  return response.data;
}

/* =========================================================
   SALES
========================================================= */

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
};

/**
 * Saves a New Sale. The cash it brings in is owed by the accountable MAS until a New Sales remittance covers it, so
 * each sale starts Outstanding (Sales AJ remittance_status, AK linked_remittance_id, AL accountable_employee_id).
 * A batch's remittance penalty (AM amount, AN note) is passed for the batch's first sale only.
 */
export async function addSale(
  sale: SaleSheetData,
  accountableEmployeeId: string,
  penalty: { amount: number; note: string } = { amount: 0, note: "" },
  // AO mas_incentive, AP remittance_amount (what the company is owed), AQ fidelity_amount (batch's first sale only).
  quote: { incentive: number; remittance: number; fidelity: number },
) {
  const values = [
    sale.saleId,
    sale.dateCreated,

    sale.branch,
    sale.mas,
    sale.dateRemitted,

    sale.memberNumber,

    sale.surname,
    sale.firstName,
    sale.middleName,
    sale.nameExtension,

    sale.birthdate,
    sale.birthplace,
    sale.gender,
    sale.age,
    sale.civilStatus,
    sale.contactNumber,

    sale.addressHouse,

    sale.claimantName,
    sale.claimantContact,
    sale.claimantSameAsMember,

    sale.claimantAddressHouse,

    sale.programId,
    sale.doi,

    sale.paymentMethod,
    sale.registrationFee,
    sale.registrationAmount,
    sale.amountPaid,

    sale.programTerms,

    sale.applicationNo,
    sale.orNumber,
    sale.orDate,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${SALES_SHEET}!A:AE`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    }, [["Outstanding", "", accountableEmployeeId, penalty.amount > 0 ? penalty.amount : "", penalty.amount > 0 ? penalty.note : "", quote.incentive, quote.remittance, quote.fidelity > 0 ? quote.fidelity : ""]]);

  return response.data;
}

/* =========================================================
   PROGRAMS
========================================================= */

export type ProgramSheetData = {
  id: string;
  code: string;
  name: string;
  basePay: number;
  status: "active" | "inactive";
  description: string;
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
} & AgeRestriction;

export type BranchSheetData = {
  id: string;
  name: string;
  territory: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  country: string;
  postalCode: string;
  contactNumber: string;
  email: string;
  dateOpened: string;
  dateClosed: string;
  status: "active" | "inactive";
};

async function ensureBranchesSheet() {
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${BRANCHES_SHEET}!A:M`,
    });
  } catch (error: unknown) {
    const status =
      typeof error === "object" && error !== null && "code" in error
        ? Number(error.code)
        : 0;

    if (status !== 400) {
      throw error;
    }

    getEncoder();
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: GOOGLE_SHEET_ID,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: { title: BRANCHES_SHEET },
            },
          },
        ],
      },
    });

    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${BRANCHES_SHEET}!A:P`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          "Branch ID",
          "Branch Name / Code",
          "Territory",
          "Barangay",
          "City / Municipality",
          "Province",
          "Country",
          "Postal Code",
          "Contact Number",
          "Email",
          "Date Opened",
          "Date Closed",
          "Status",
          ...encoderHeaders,
        ]],
      },
    });
  }
}

export async function getBranches(): Promise<BranchSheetData[]> {
  await ensureBranchesSheet();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${BRANCHES_SHEET}!A:M`,
  });

  return (response.data.values ?? [])
    .slice(1)
    .filter((row) => String(row[0] ?? "").trim() !== "")
    .map((row) => {
      const hasFullBranchColumns = row.length >= 13;

      return {
        id: String(row[0] ?? "").trim(),
        name: String(row[1] ?? "").trim(),
        territory: String(row[2] ?? "").trim(),
        barangay: hasFullBranchColumns
          ? String(row[3] ?? "").trim()
          : "",
        cityMunicipality: hasFullBranchColumns
          ? String(row[4] ?? "").trim()
          : "",
        province: hasFullBranchColumns
          ? String(row[5] ?? "").trim()
          : "",
        country: hasFullBranchColumns
          ? String(row[6] ?? "").trim()
          : "",
        postalCode: hasFullBranchColumns
          ? String(row[7] ?? "").trim()
          : "",
        contactNumber: hasFullBranchColumns
          ? String(row[8] ?? "").trim()
          : "",
        email: hasFullBranchColumns
          ? String(row[9] ?? "").trim()
          : "",
        dateOpened: hasFullBranchColumns
          ? String(row[10] ?? "").trim()
          : "",
        dateClosed: hasFullBranchColumns
          ? String(row[11] ?? "").trim()
          : "",
        status:
          String(
            row[hasFullBranchColumns ? 12 : 2] ?? "",
          )
            .trim()
            .toLowerCase() === "inactive"
            ? ("inactive" as const)
            : ("active" as const),
      };
    });
}

export async function createBranch(data: {
  name: string;
  territory: string;
  barangay: string;
  cityMunicipality: string;
  province: string;
  country: string;
  postalCode: string;
  contactNumber: string;
  email: string;
  dateOpened: string;
  dateClosed: string;
  status: "active" | "inactive";
}): Promise<BranchSheetData> {
  const branches = await getBranches();
  const highestId = branches.reduce((highest, branch) => {
    const match = /^BR-(\d+)$/.exec(branch.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  const branch: BranchSheetData = {
    id: `BR-${String(highestId + 1).padStart(4, "0")}`,
    name: data.name.trim(),
    territory: data.territory.trim(),
    barangay: data.barangay.trim(),
    cityMunicipality: data.cityMunicipality.trim(),
    province: data.province.trim(),
    country: data.country.trim(),
    postalCode: data.postalCode.trim(),
    contactNumber: data.contactNumber.trim(),
    email: data.email.trim(),
    dateOpened: data.dateOpened.trim(),
    dateClosed: data.dateClosed.trim(),
    status: data.status === "inactive" ? "inactive" : "active",
  };

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${BRANCHES_SHEET}!A:M`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        branch.id,
        branch.name,
        branch.territory,
        branch.barangay,
        branch.cityMunicipality,
        branch.province,
        branch.country,
        branch.postalCode,
        branch.contactNumber,
        branch.email,
        branch.dateOpened,
        branch.dateClosed,
        branch.status,
      ]],
    },
  });

  return branch;
}

/* =========================================================
   PROGRAM INCENTIVES
========================================================= */

export type ProgramIncentiveSheetData = {
  id: string;
  programId: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType:
    | "fixed"
    | "percentage";
  markUp: number;
  incentiveAmount: number;
};

export type CreateProgramData = {
  saleIncentiveType?: unknown;
  saleIncentiveAmount?: unknown;
  code: string;
  name: string;
  basePay: number;

  incentiveTiers: Array<{
    role: "MAS" | "Collector";
    fromMonth: number;
    toMonth: number;
    incentiveType:
      | "fixed"
      | "percentage";
    markUp: number;
    incentiveAmount: number;
  }>;

  description: string;
  status: "active" | "inactive";
  registrationFeeRequired: boolean;
  registrationAmount: number;
  payBalanceTotal: number;
  // Raw form values; normalizeAgeRestriction validates them before saving.
  ageRestricted?: unknown;
  minAge?: unknown;
  maxAge?: unknown;
};

/* =========================================================
   GET PROGRAMS
========================================================= */

export async function getPrograms() {
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: [`${PROGRAMS_SHEET}!A:R`, `${PROGRAM_INCENTIVES_SHEET}!A:H`],
  });
  const rows = response.data.valueRanges?.[0]?.values ?? [];
  if (rows.length <= 1) {
    return [];
  }

  const programs = rows
    .slice(1)
    .filter((row) => {
      return (
        String(row[0] ?? "").trim() !== ""
      );
    })
    .map((row) => ({
      id: String(row[0] ?? "").trim(),

      code: String(row[1] ?? "").trim(),

      name: String(row[2] ?? "").trim(),

      basePay:
        Number(row[3] ?? 0) || 0,

      status:
        String(row[4] ?? "")
          .trim()
          .toLowerCase() === "inactive"
          ? ("inactive" as const)
          : ("active" as const),

      description:
        String(row[5] ?? ""),
      registrationFeeRequired: String(row[10] ?? "").trim().toLowerCase() === "yes" || row[10] === true,
      registrationAmount: Number(row[11] ?? 0) || 0,
      payBalanceTotal: Number(row[12] ?? 0) || 0,
      ...readAgeRestriction(row),
      // New Sale incentive for programs with a registration fee (Programs Q type, R amount).
      saleIncentiveType: (["fixed", "percentage"].includes(String(row[16] ?? "").trim()) ? String(row[16]).trim() : "") as "fixed" | "percentage" | "",
      saleIncentiveAmount: Number(row[17] ?? 0) || 0,
    }));

  const incentives =
    await getProgramIncentives(undefined, response.data.valueRanges?.[1]?.values ?? []);

  return programs.map((program) => ({
    ...program,

    incentiveTiers:
      incentives
        .filter(
          (incentive) =>
            incentive.programId ===
            program.id,
        )
        .sort(
          (a, b) =>
            a.fromMonth -
            b.fromMonth,
        ),
  }));
}

/* =========================================================
   GET PROGRAM BY ID
========================================================= */

export async function getProgramById(
  programId: string,
) {
  const normalizedProgramId =
    programId.trim();

  if (!normalizedProgramId) {
    return null;
  }

  const programs =
    await getPrograms();

  return (
    programs.find(
      (program) =>
        program.id ===
        normalizedProgramId,
    ) ?? null
  );
}

/* =========================================================
   GENERATE PROGRAM ID
   DP-0001
   DP-0002
   DP-0003
========================================================= */

export async function generateProgramId() {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAMS_SHEET}!A:A`,
    });

  const rows =
    response.data.values ?? [];

  let highestNumber = 0;

  for (const row of rows.slice(1)) {
    const value =
      String(row[0] ?? "").trim();

    const match =
      /^DP-(\d+)$/.exec(value);

    if (!match) {
      continue;
    }

    const number =
      Number(match[1]);

    if (
      Number.isFinite(number) &&
      number > highestNumber
    ) {
      highestNumber = number;
    }
  }

  const nextNumber =
    highestNumber + 1;

  return `DP-${String(
    nextNumber,
  ).padStart(4, "0")}`;
}

/* =========================================================
   ADD PROGRAM
========================================================= */

export async function addProgram(
  program: ProgramSheetData,
) {
  const values = [
    program.id,
    program.code,
    program.name,
    program.basePay,
    program.status,
    program.description,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAMS_SHEET}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

  return response.data;
}

/* =========================================================
   CREATE PROGRAM
========================================================= */

export async function createProgram(
  data: CreateProgramData,
) {
  const programId =
    await generateProgramId();

  const program: ProgramSheetData = {
    id: programId,

    code: data.code.trim(),

    name: data.name.trim(),

    basePay:
      Number(data.basePay) || 0,

    status:
      data.status === "inactive"
        ? "inactive"
        : "active",

    description:
      data.description.trim(),

    registrationFeeRequired: Boolean(data.registrationFeeRequired),
    registrationAmount: Number(data.registrationAmount) || 0,
    payBalanceTotal: Number(data.payBalanceTotal) || 0,
    ...normalizeAgeRestriction(data),
  };

  /*
   * Save the main program.
   */
  await addProgram(program);

  const programRows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${PROGRAMS_SHEET}!A:A` })).data.values ?? [];
  const rowNumber = programRows.findIndex((row) => String(row[0] ?? "").trim() === programId) + 1;
  if (rowNumber > 1) await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${PROGRAMS_SHEET}!K${rowNumber}:R${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [[data.registrationFeeRequired ? "Yes" : "No", data.registrationAmount, data.payBalanceTotal, ...ageRestrictionCells(program), ...saleIncentiveCells(data)]] },
  });

  /*
   * Save all incentive tiers.
   *
   * Each tier belongs to either:
   * MAS
   * or
   * Collector
   *
   * Mark Up is stored separately
   * from the incentive amount.
   */
  for (const tier of data.incentiveTiers) {
    await addProgramIncentive({
      id: createReadableId("INC"),

      programId: program.id,

      role: tier.role,

      fromMonth:
        Number(tier.fromMonth),

      toMonth:
        Number(tier.toMonth),

      incentiveType:
        tier.incentiveType,

      markUp:
        Number(tier.markUp) || 0,

      incentiveAmount:
        Number(tier.incentiveAmount),
    });
  }

  /*
   * Return the program together with
   * its incentive tiers.
   */
  return {
    ...program,

    incentiveTiers:
      data.incentiveTiers.map(
        (tier) => ({
          id: createReadableId("INC"),
          programId: program.id,

          role: tier.role,

          fromMonth:
            Number(tier.fromMonth),

          toMonth:
            Number(tier.toMonth),

          incentiveType:
            tier.incentiveType,

          markUp:
            Number(tier.markUp) || 0,

          incentiveAmount:
            Number(
              tier.incentiveAmount,
            ) || 0,
        }),
      ),
  };
}

/* =========================================================
   GET PROGRAM INCENTIVES
========================================================= */

export async function getProgramIncentives(
  programId?: string,
  preloadedRows?: unknown[][],
) {
  /*
   * Program Incentives now uses
   * columns A:H:
   *
   * A Incentive ID
   * B Program ID
   * C Role
   * D From Month
   * E To Month
   * F Incentive Type
   * G Mark Up
   * H Incentive Amount
   */
  const rows = preloadedRows ?? (await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${PROGRAM_INCENTIVES_SHEET}!A:H`,
  })).data.values ?? [];

  if (rows.length <= 1) {
    return [];
  }

  const incentives =
    rows
      .slice(1)
      .filter((row) => {
        return (
          String(row[0] ?? "").trim() !==
          ""
        );
      })
      .map((row) => {
        const fromMonth =
          Number(row[3] ?? 1);

        const toMonth =
          Number(row[4] ?? 1);

        const markUp =
          Number(row[6] ?? 0);

        const incentiveAmount =
          Number(row[7] ?? 0);

        return {
          id: String(
            row[0] ?? "",
          ).trim(),

          programId: String(
            row[1] ?? "",
          ).trim(),

          role:
            String(row[2] ?? "")
              .trim()
              .toLowerCase() ===
            "collector"
              ? ("Collector" as const)
              : ("MAS" as const),

          fromMonth:
            Number.isFinite(fromMonth) &&
            fromMonth >= 1
              ? fromMonth
              : 1,

          toMonth:
            Number.isFinite(toMonth) &&
            toMonth >= 1
              ? toMonth
              : 1,

          incentiveType:
            String(row[5] ?? "")
              .trim()
              .toLowerCase() ===
            "fixed"
              ? ("fixed" as const)
              : ("percentage" as const),

          /*
           * Mark Up is stored in column G.
           *
           * 0 is a valid Mark Up.
           */
          markUp:
            Number.isFinite(markUp)
              ? markUp
              : 0,

          /*
           * Incentive Amount is stored
           * in column H.
           *
           * 0 is a valid incentive.
           */
          incentiveAmount:
            Number.isFinite(
              incentiveAmount,
            )
              ? incentiveAmount
              : 0,
        };
      });

  if (!programId) {
    return incentives;
  }

  const normalizedProgramId =
    programId.trim();

  return incentives.filter(
    (incentive) =>
      incentive.programId ===
      normalizedProgramId,
  );
}

/* =========================================================
   GET INCENTIVE FOR PROGRAM + ROLE + MONTH
========================================================= */

export async function getProgramIncentiveForMonth(
  programId: string,
  role: "MAS" | "Collector",
  month: number,
) {
  const normalizedProgramId =
    programId.trim();

  const normalizedMonth =
    Number(month);

  if (
    !normalizedProgramId ||
    !Number.isFinite(
      normalizedMonth,
    ) ||
    normalizedMonth < 1
  ) {
    return null;
  }

  const incentives =
    await getProgramIncentives(
      normalizedProgramId,
    );

  const matchingIncentives =
    incentives
      .filter(
        (incentive) =>
          incentive.role === role &&
          normalizedMonth >=
            incentive.fromMonth &&
          normalizedMonth <=
            incentive.toMonth,
      )
      .sort(
        (a, b) =>
          b.fromMonth -
          a.fromMonth,
      );

  return (
    matchingIncentives[0] ?? null
  );
}

/* =========================================================
   ADD PROGRAM INCENTIVE
========================================================= */

export async function addProgramIncentive(
  incentive: ProgramIncentiveSheetData,
) {
  const fromMonth =
    Number(incentive.fromMonth);

  const toMonth =
    Number(incentive.toMonth);

  const markUp =
    Number(incentive.markUp);

  const incentiveAmount =
    Number(
      incentive.incentiveAmount,
    );

  const values = [
    incentive.id,

    incentive.programId,

    incentive.role,

    Number.isFinite(fromMonth) &&
    fromMonth >= 1
      ? fromMonth
      : 1,

    Number.isFinite(toMonth) &&
    toMonth >= 1
      ? toMonth
      : 999999,

    incentive.incentiveType,

    /*
     * Mark Up is stored in column G.
     *
     * 0 is a valid Mark Up.
     */
    Number.isFinite(markUp)
      ? markUp
      : 0,

    /*
     * Incentive Amount is stored
     * in column H.
     *
     * 0 is a valid incentive.
     */
    Number.isFinite(
      incentiveAmount,
    )
      ? incentiveAmount
      : 0,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAM_INCENTIVES_SHEET}!A:H`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

  return response.data;
}

/* =========================================================
   ADD PROGRAM WITH INCENTIVES
========================================================= */

export async function addProgramWithIncentives(
  program: ProgramSheetData,
  incentives: ProgramIncentiveSheetData[],
) {
  /*
   * Save the program first.
   */
  await addProgram(program);

  /*
   * Then save every incentive tier.
   *
   * Mark Up and Incentive Amount
   * are saved separately.
   *
   * 0 is intentionally allowed
   * for both values.
   */
  for (const incentive of incentives) {
    await addProgramIncentive(
      incentive,
    );
  }

  return {
    program,
    incentives,
  };
}

export type LoginRole = {
  id: string;
  name: string;
  manageUsers: boolean;
  manageAttendance: boolean;
  viewAttendanceReports: boolean;
  pages: string[] | null;
};

export type LoginUserData = {
  id: string;
  employeeId: string;
  fullName: string;
  passwordHash: string;
  roles: LoginRole[];
};

export type AttendanceEmployee = {
  employeeId: string;
  fullName: string;
};

export type MasStaff = {
  employeeId: string;
  fullName: string;
};

function isEnabled(value: unknown) {
  return ["true", "yes", "1"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

export async function getLoginUserByEmployeeId(
  employeeId: string,
): Promise<LoginUserData | null> {
  const normalizedId = employeeId.trim().toUpperCase();
  if (!normalizedId) return null;

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: GOOGLE_SHEET_ID,
    ranges: [USERS_RANGE, "Roles!A:L", "'User Roles'!A:B"],
  });
  const { users } = readUserRows(response.data.valueRanges?.[0]?.values ?? []);
  const roles = response.data.valueRanges?.[1]?.values ?? [];
  const userRoles = response.data.valueRanges?.[2]?.values ?? [];

  const user = users.find((row) => row.employeeId.toUpperCase() === normalizedId && row.status === "active");
  if (!user) return null;

  const assignedRoleIds = new Set(
    userRoles
      .slice(1)
      .filter((row) => String(row[0] ?? "").trim() === user.id)
      .map((row) => String(row[1] ?? "").trim())
      .filter(Boolean),
  );

  const uniqueRoleIds = new Set<string>();
  const assignedRoles = roles
    .slice(1)
    .filter((row) => {
      const roleId = String(row[0] ?? "").trim();
      const status = String(row[6] ?? "").trim().toLowerCase();
      const allowed = assignedRoleIds.has(roleId) && status === "active" && !uniqueRoleIds.has(roleId);
      if (allowed) uniqueRoleIds.add(roleId);
      return allowed;
    })
    .map((row): LoginRole => ({
      id: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
      manageUsers: isEnabled(row[3]),
      manageAttendance: isEnabled(row[4]),
      viewAttendanceReports: isEnabled(row[5]),
      pages: parsePageAccess(row[11]),
    }));

  return {
    id: user.id,
    employeeId: user.employeeId,
    fullName: user.fullName,
    passwordHash: user.passwordHash,
    roles: assignedRoles,
  };
}

export type AccountRole = {
  id: string;
  name: string;
};

export type CreateEmployeeAccountData = {
  employeeId?: string;
  fullName: string;
  passwordHash: string;
  roleIds: string[];
};

export async function getActiveAccountRoles(): Promise<
  AccountRole[]
> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Roles!A:G",
    });

  const roles = (response.data.values ?? [])
    .slice(1)
    .filter((row) => {
      const status = String(row[6] ?? "")
        .trim()
        .toLowerCase();

      return (
        String(row[0] ?? "").trim() !== "" &&
        status === "active"
      );
    })
    .map((row) => ({
      id: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
    }));
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const role of roles) {
    if (ids.has(role.id)) throw new Error(`Duplicate role ID ${role.id}. Run the roles migration before assigning accounts.`);
    const name=role.name.trim().toLowerCase();
    if(names.has(name))throw new Error(`Duplicate role name ${role.name}. Keep one canonical role before assigning accounts.`);
    ids.add(role.id);
    names.add(name);
  }
  return roles;
}

export async function createEmployeeAccount(
  data: CreateEmployeeAccountData,
) {
  const employeeId = (data.employeeId ?? "").trim().toUpperCase();
  const fullName = data.fullName.trim();

  if (!fullName) throw new Error("Full name is required.");
  if (!data.passwordHash) throw new Error("Password hash is required.");
  if (data.roleIds.length === 0) throw new Error("Select at least one role.");

  const [{ columns, users }, activeRoles] = await Promise.all([loadUsers(), getActiveAccountRoles()]);
  assertUsernameColumnRemoved(columns);

  if (!isEmployeeIdFormat(employeeId)) throw new Error(EMPLOYEE_ID_FORMAT_MESSAGE);
  // The Employee ID is the sign-in identifier, so each may hold only one account.
  if (users.some((user) => user.employeeId.toUpperCase() === employeeId)) throw new Error("This Employee ID already has a user account.");

  const activeRoleIds = new Set(activeRoles.map((role) => role.id));
  const roleIds = [...new Set(data.roleIds.map((roleId) => roleId.trim()).filter(Boolean))];
  if (roleIds.some((roleId) => !activeRoleIds.has(roleId))) throw new Error("One or more selected roles are invalid or inactive.");

  const highestUserNumber = users.reduce((highest, user) => {
    const match = /^USR-(\d+)$/.exec(user.id);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const userId = `USR-${String(highestUserNumber + 1).padStart(4, "0")}`;
  const createdAt = new Date().toISOString().split("T")[0];

  const row: string[] = [];
  row[columns.id] = userId;
  row[columns.employeeId] = employeeId;
  row[columns.fullName] = fullName;
  row[columns.passwordHash] = data.passwordHash;
  row[columns.status] = "active";
  row[columns.createdAt] = createdAt;
  row[columns.roleId] = roleIds[0];

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Users!A:G",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [Array.from(row, (value) => value ?? "")] },
  });

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "User Roles!A:B",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: roleIds.map((roleId) => [userId, roleId]) },
  });

  return { id: userId, employeeId, fullName, roleIds };
}

export async function getActiveMasStaff(): Promise<MasStaff[]> {
  const [usersResponse, rolesResponse, userRolesResponse] =
    await Promise.all([
      loadUsers(),
      sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Roles!A:G" }),
      sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'User Roles'!A:B" }),
    ]);
  const masRoleIds = new Set(
    (rolesResponse.data.values ?? []).slice(1).filter((row) => {
      const name = String(row[1] ?? "").trim().toLowerCase();
      return String(row[6] ?? "").trim().toLowerCase() === "active" &&
        (name === "mas" || name === "marketing account staff");
    }).map((row) => String(row[0] ?? "").trim()),
  );
  const masUserIds = new Set(
    (userRolesResponse.data.values ?? []).slice(1).filter((row) =>
      masRoleIds.has(String(row[1] ?? "").trim()),
    ).map((row) => String(row[0] ?? "").trim()),
  );
  const legacy = usersResponse.users.filter((user) =>
    masUserIds.has(user.id) && user.status === "active",
  ).map((user) => ({ employeeId: user.employeeId, fullName: user.fullName }))
    .filter((staff) => staff.employeeId !== "")
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
  const employees = await getEmployees();
  // Every active employee may own member accounts. "MAS" remains the UI label
  // for the accountable employee for compatibility with existing sheets.
  const registered = employees.filter((e) => e.status.toLowerCase() === "active").map((e) => ({ employeeId: e.id, fullName: e.name }));
  const reviewed = new Set(employees.filter((e) => e.status || e.roles.length).map((e) => e.id));
  return [...new Map([...legacy.filter((e) => !reviewed.has(e.employeeId)), ...registered].map((e) => [e.employeeId, e])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));

}

export type CollectionSheetData = {
  collectionId: string;
  remittanceId: string;
  enrollmentId: string;
  memberId: string;
  memberNumber: string;
  programId: string;
  branch: string;
  mas: string;
  orNumber: string;
  orDate: string;
  amountCollected: number;
  monthFrom: string;
  monthTo: string;
  nopFrom: number;
  nopTo: number;
  reactivation: string;
  transferred: string;
  suspended: string;
  originalMas: string;
  status: string;
  createdAt: string;
};

export async function addRemittance({
  id,
  branch,
  mas,
  dateRemitted,
  createdAt,
}: {
  id: string;
  branch: string;
  mas: string;
  dateRemitted: string;
  createdAt: string;
}) {
  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${REMITTANCES_SHEET}!A:F`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[id, branch, mas, dateRemitted, "Posted", createdAt]],
    },
  });
}

export async function addCollections(
  collections: CollectionSheetData[],
) {
  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${COLLECTIONS_SHEET}!A:U`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: collections.map((collection) => [
        collection.collectionId,
        collection.remittanceId,
        collection.enrollmentId,
        collection.memberId,
        collection.memberNumber,
        collection.programId,
        collection.branch,
        collection.mas,
        collection.orNumber,
        collection.orDate,
        collection.amountCollected,
        collection.monthFrom,
        collection.monthTo,
        collection.nopFrom,
        collection.nopTo,
        collection.reactivation,
        collection.transferred,
        collection.suspended,
        collection.originalMas,
        collection.status,
        collection.createdAt,
      ]),
    },
  });
}

export async function getCollectionHistory(
  memberId: string,
  programId: string,
) {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${COLLECTIONS_SHEET}!A:U`,
  });

  return (response.data.values ?? [])
    .slice(1)
    .filter(
      (row) =>
        String(row[3] ?? "").trim() === memberId &&
        String(row[5] ?? "").trim() === programId,
    )
    .map((row) => ({
      id: String(row[0] ?? "").trim(),
      memberId: String(row[3] ?? "").trim(),
      programId: String(row[5] ?? "").trim(),
      orNumber: String(row[8] ?? "").trim(),
      orDate: String(row[9] ?? "").trim(),
      amountCollected: Number(row[10] ?? 0) || 0,
      monthOf: String(row[12] ?? "").trim(),
      nop: Number(row[14] ?? 0) || 0,
      dateRemitted: "",
    }))
    .sort((first, second) => second.nop - first.nop);
}

export async function getActiveAttendanceEmployees(): Promise<
  AttendanceEmployee[]
> {
  const legacy = (await loadUsers()).users
    .filter((user) => user.status === "active")
    .map((user) => ({ employeeId: user.employeeId, fullName: user.fullName }))
    .filter((employee) => employee.employeeId !== "")
    .sort((first, second) =>
      first.fullName.localeCompare(second.fullName),
    );
  const employees = await getEmployees();
  const reviewed = new Set(employees.filter((e) => e.status).map((e) => e.id));
  const registered = employees.filter((e) => e.status.toLowerCase() === "active").map((e) => ({ employeeId: e.id, fullName: e.name }));
  return [...new Map([...legacy.filter((e) => !reviewed.has(e.employeeId)), ...registered].map((e) => [e.employeeId, e])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));

}

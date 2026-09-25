import { appendEncodedRows } from "@/lib/encoder-sheets";
import { getEncoder } from "@/lib/encoder-context";
import { encoderHeaders } from "@/lib/encoder-schema";
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
  addressStreet: string;
  addressSubdivision: string;
  addressBarangay: string;
  addressCity: string;
  addressProvince: string;
  addressZip: string;

  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: string;

  claimantAddressHouse: string;
  claimantAddressStreet: string;
  claimantAddressSubdivision: string;
  claimantAddressBarangay: string;
  claimantAddressCity: string;
  claimantAddressProvince: string;
  claimantAddressZip: string;

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
    member.addressStreet,
    member.addressSubdivision,
    member.addressBarangay,
    member.addressCity,
    member.addressProvince,
    member.addressZip,

    member.claimantName,
    member.claimantContact,
    member.claimantSameAsMember,

    member.claimantAddressHouse,
    member.claimantAddressStreet,
    member.claimantAddressSubdivision,
    member.claimantAddressBarangay,
    member.claimantAddressCity,
    member.claimantAddressProvince,
    member.claimantAddressZip,

    member.status,
  ];

  const response =
    await appendEncodedRows({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBERS_SHEET}!A:AD`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

  return response.data;
}

export async function findMemberByNumber(
  memberNumber: string,
) {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBERS_SHEET}!A:AD`,
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
) {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${MEMBERS_SHEET}!A:AD`,
    });

  const rows = response.data.values ?? [];

  if (rows.length <= 1) {
    return [];
  }

  const searchTerm =
    search.trim().toLowerCase();

  if (!searchTerm) {
    return [];
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

      return fullName.includes(
        searchTerm,
      );
    })
    .slice(0, 5)
    .map((row) => ({
      id: row[0] ?? "",
      phMemberNumber: row[1] ?? "",

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
        street: row[13] ?? "",
        subdivisionVillage:
          row[14] ?? "",
        barangay: row[15] ?? "",
        municipalityCity:
          row[16] ?? "",
        province: row[17] ?? "",
        zipCode: row[18] ?? "",
      },

      claimant: {
        completeName: row[19] ?? "",
        contactNumber: row[20] ?? "",

        sameAsMemberAddress: [
          "true",
          "yes",
        ].includes(
          String(row[21] ?? "")
            .trim()
            .toLowerCase(),
        ),

        address: {
          houseBlockLot: row[22] ?? "",
          street: row[23] ?? "",
          subdivisionVillage:
            row[24] ?? "",
          barangay: row[25] ?? "",
          municipalityCity:
            row[26] ?? "",
          province: row[27] ?? "",
          zipCode: row[28] ?? "",
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
  addressStreet: string;
  addressSubdivision: string;
  addressBarangay: string;
  addressCity: string;
  addressProvince: string;
  addressZip: string;

  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: string;

  claimantAddressHouse: string;
  claimantAddressStreet: string;
  claimantAddressSubdivision: string;
  claimantAddressBarangay: string;
  claimantAddressCity: string;
  claimantAddressProvince: string;
  claimantAddressZip: string;

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

export async function addSale(
  sale: SaleSheetData,
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
    sale.addressStreet,
    sale.addressSubdivision,
    sale.addressBarangay,
    sale.addressCity,
    sale.addressProvince,
    sale.addressZip,

    sale.claimantName,
    sale.claimantContact,
    sale.claimantSameAsMember,

    sale.claimantAddressHouse,
    sale.claimantAddressStreet,
    sale.claimantAddressSubdivision,
    sale.claimantAddressBarangay,
    sale.claimantAddressCity,
    sale.claimantAddressProvince,
    sale.claimantAddressZip,

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
      range: `${SALES_SHEET}!A:AQ`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [values],
      },
    });

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
};

export type BranchSheetData = {
  id: string;
  name: string;
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
      range: `${BRANCHES_SHEET}!A:L`,
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
    range: `${BRANCHES_SHEET}!A:L`,
  });

  return (response.data.values ?? [])
    .slice(1)
    .filter((row) => String(row[0] ?? "").trim() !== "")
    .map((row) => {
      const hasFullBranchColumns = row.length >= 12;

      return {
        id: String(row[0] ?? "").trim(),
        name: String(row[1] ?? "").trim(),
        barangay: hasFullBranchColumns
          ? String(row[2] ?? "").trim()
          : "",
        cityMunicipality: hasFullBranchColumns
          ? String(row[3] ?? "").trim()
          : "",
        province: hasFullBranchColumns
          ? String(row[4] ?? "").trim()
          : "",
        country: hasFullBranchColumns
          ? String(row[5] ?? "").trim()
          : "",
        postalCode: hasFullBranchColumns
          ? String(row[6] ?? "").trim()
          : "",
        contactNumber: hasFullBranchColumns
          ? String(row[7] ?? "").trim()
          : "",
        email: hasFullBranchColumns
          ? String(row[8] ?? "").trim()
          : "",
        dateOpened: hasFullBranchColumns
          ? String(row[9] ?? "").trim()
          : "",
        dateClosed: hasFullBranchColumns
          ? String(row[10] ?? "").trim()
          : "",
        status:
          String(
            row[hasFullBranchColumns ? 11 : 2] ?? "",
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
    range: `${BRANCHES_SHEET}!A:L`,
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        branch.id,
        branch.name,
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
};

/* =========================================================
   GET PROGRAMS
========================================================= */

export async function getPrograms() {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAMS_SHEET}!A:F`,
    });

  const rows = response.data.values ?? [];

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
    }));

  const incentives =
    await getProgramIncentives();

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
  };

  /*
   * Save the main program.
   */
  await addProgram(program);

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
      id: crypto.randomUUID(),

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
          id: crypto.randomUUID(),
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
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAM_INCENTIVES_SHEET}!A:H`,
    });

  const rows =
    response.data.values ?? [];

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
};

export type LoginUserData = {
  id: string;
  employeeId: string;
  username: string;
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

export async function getLoginUserByUsername(
  username: string,
): Promise<LoginUserData | null> {
  const normalizedUsername = username
    .trim()
    .toLowerCase();

  if (!normalizedUsername) {
    return null;
  }

  const [usersResponse, rolesResponse, userRolesResponse] =
    await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Users!A:G",
      }),

      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Roles!A:G",
      }),

      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "'User Roles'!A:B",
      }),
    ]);

  const users = usersResponse.data.values ?? [];
  const roles = rolesResponse.data.values ?? [];
  const userRoles = userRolesResponse.data.values ?? [];

  const userRow = users.slice(1).find((row) => {
    const rowUsername = String(row[2] ?? "")
      .trim()
      .toLowerCase();

    const status = String(row[5] ?? "")
      .trim()
      .toLowerCase();

    return (
      rowUsername === normalizedUsername &&
      status === "active"
    );
  });

  if (!userRow) {
    return null;
  }

  const userId = String(userRow[0] ?? "").trim();

  const assignedRoleIds = new Set(
    userRoles
      .slice(1)
      .filter(
        (row) =>
          String(row[0] ?? "").trim() === userId,
      )
      .map((row) => String(row[1] ?? "").trim())
      .filter(Boolean),
  );

  const assignedRoles = roles
    .slice(1)
    .filter((row) => {
      const roleId = String(row[0] ?? "").trim();
      const status = String(row[6] ?? "")
        .trim()
        .toLowerCase();

      return (
        assignedRoleIds.has(roleId) &&
        status === "active"
      );
    })
    .map((row): LoginRole => ({
      id: String(row[0] ?? "").trim(),
      name: String(row[1] ?? "").trim(),
      manageUsers: isEnabled(row[3]),
      manageAttendance: isEnabled(row[4]),
      viewAttendanceReports: isEnabled(row[5]),
    }));

  return {
    id: userId,
    employeeId: String(userRow[1] ?? "").trim(),
    username: String(userRow[2] ?? "").trim(),
    fullName: String(userRow[3] ?? "").trim(),
    passwordHash: String(userRow[4] ?? "").trim(),
    roles: assignedRoles,
  };
}

export type AccountRole = {
  id: string;
  name: string;
};

export type CreateEmployeeAccountData = {
  employeeId?: string;
  username: string;
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

  return (response.data.values ?? [])
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
}

export async function createEmployeeAccount(
  data: CreateEmployeeAccountData,
) {
  const username = data.username
    .trim()
    .toLowerCase();

  let employeeId = (data.employeeId ?? "")
    .trim()
    .toUpperCase();

  const fullName = data.fullName.trim();


  if (!username) {
    throw new Error("Username is required.");
  }

  if (!fullName) {
    throw new Error("Full name is required.");
  }

  if (!data.passwordHash) {
    throw new Error("Password hash is required.");
  }

  if (data.roleIds.length === 0) {
    throw new Error("Select at least one role.");
  }

  const [usersResponse, activeRoles] =
    await Promise.all([
      sheets.spreadsheets.values.get({
        spreadsheetId: GOOGLE_SHEET_ID,
        range: "Users!A:H",
      }),

      getActiveAccountRoles(),
    ]);

  const users = usersResponse.data.values ?? [];

  if (!employeeId) {
    const highest = users.slice(1).reduce((max, row) => {
      const match = /^DPE-(\d{4})$/.exec(String(row[1] ?? "").trim());
      return match ? Math.max(max, Number(match[1])) : max;
    }, 0);
    employeeId = `DPE-${String(highest + 1).padStart(4, "0")}`;
  }

  if (!/^DPE-\d{4}$/.test(employeeId)) throw new Error("Employee ID must use the format DPE-0001.");

  const duplicateUsername = users
    .slice(1)
    .some(
      (row) =>
        String(row[2] ?? "")
          .trim()
          .toLowerCase() === username,
    );

  if (duplicateUsername) {
    throw new Error("This username already exists.");
  }

  const duplicateEmployeeId = users
    .slice(1)
    .some(
      (row) =>
        String(row[1] ?? "")
          .trim()
          .toUpperCase() === employeeId,
    );

  if (duplicateEmployeeId) {
    throw new Error("This Employee ID already exists.");
  }

  const activeRoleIds = new Set(
    activeRoles.map((role) => role.id),
  );

  const roleIds = [
    ...new Set(
      data.roleIds
        .map((roleId) => roleId.trim())
        .filter(Boolean),
    ),
  ];

  if (
    roleIds.some(
      (roleId) => !activeRoleIds.has(roleId),
    )
  ) {
    throw new Error(
      "One or more selected roles are invalid or inactive.",
    );
  }

  const highestUserNumber = users
    .slice(1)
    .reduce((highest, row) => {
      const match = /^USR-(\d+)$/.exec(
        String(row[0] ?? "").trim(),
      );

      return match
        ? Math.max(highest, Number(match[1]))
        : highest;
    }, 0);

  const userId = `USR-${String(
    highestUserNumber + 1,
  ).padStart(4, "0")}`;

  const createdAt = new Date()
    .toISOString()
    .split("T")[0];

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "Users!A:H",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: [[
        userId,
        employeeId,
        username,
        fullName,
        data.passwordHash,
        "active",
        createdAt,
        "",
      ]],
    },
  });

  await appendEncodedRows({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: "User Roles!A:B",
    valueInputOption: "USER_ENTERED",
    insertDataOption: "INSERT_ROWS",
    requestBody: {
      values: roleIds.map((roleId) => [
        userId,
        roleId,
      ]),
    },
  });

  return {
    id: userId,
    employeeId,
    username,
    fullName,
    roleIds,
  };
}

export async function getActiveMasStaff(): Promise<MasStaff[]> {
  const [usersResponse, rolesResponse, userRolesResponse] =
    await Promise.all([
      sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:G" }),
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
  return (usersResponse.data.values ?? []).slice(1).filter((row) =>
    masUserIds.has(String(row[0] ?? "").trim()) &&
    String(row[5] ?? "").trim().toLowerCase() === "active",
  ).map((row) => ({ employeeId: String(row[1] ?? "").trim(), fullName: String(row[3] ?? "").trim() }))
    .filter((staff) => staff.employeeId !== "")
    .sort((a, b) => a.fullName.localeCompare(b.fullName));
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
    .sort((first, second) => first.nop - second.nop);
}

export async function getActiveAttendanceEmployees(): Promise<
  AttendanceEmployee[]
> {
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: "Users!A:G",
    });

  return (response.data.values ?? [])
    .slice(1)
    .filter((row) =>
      String(row[5] ?? "")
        .trim()
        .toLowerCase() === "active",
    )
    .map((row) => ({
      employeeId: String(row[1] ?? "").trim(),
      fullName: String(row[3] ?? "").trim(),
    }))
    .filter((employee) => employee.employeeId !== "")
    .sort((first, second) =>
      first.fullName.localeCompare(second.fullName),
    );
}

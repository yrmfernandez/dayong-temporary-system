import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

const SALES_SHEET = "Sales";
const MEMBERS_SHEET = "Members";
const MEMBER_PROGRAMS_SHEET = "Member Programs";
const PROGRAMS_SHEET = "Programs";
const PROGRAM_INCENTIVES_SHEET =
  "Program Incentives";

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
    await sheets.spreadsheets.values.append({
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
    await sheets.spreadsheets.values.append({
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
    await sheets.spreadsheets.values.append({
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

export type ProgramIncentiveSheetData = {
  id: string;
  programId: string;
  role: "MAS" | "Collector";
  fromMonth: number;
  toMonth: number;
  incentiveType:
    | "fixed"
    | "percentage";
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
    await sheets.spreadsheets.values.append({
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
   * 0 is a valid incentive amount.
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
  const response =
    await sheets.spreadsheets.values.get({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAM_INCENTIVES_SHEET}!A:G`,
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

        const incentiveAmount =
          Number(row[6] ?? 0);

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
           * IMPORTANT:
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
     * IMPORTANT:
     *
     * 0 must be saved.
     */
    Number.isFinite(
      incentiveAmount,
    )
      ? incentiveAmount
      : 0,
  ];

  const response =
    await sheets.spreadsheets.values.append({
      spreadsheetId: GOOGLE_SHEET_ID,
      range: `${PROGRAM_INCENTIVES_SHEET}!A:G`,
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
   * 0 is intentionally allowed.
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
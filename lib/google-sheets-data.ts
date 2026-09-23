import {
  GOOGLE_SHEET_ID,
  sheets,
} from "@/lib/google-sheets";

const SALES_SHEET = "Sales";
const MEMBERS_SHEET = "Members";
const MEMBER_PROGRAMS_SHEET = "Member Programs";

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

  for (const row of rows.slice(1)) {
    const rowMemberNumber =
      (row[1] ?? "").trim();

    if (
      rowMemberNumber === normalizedMemberNumber
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

  const searchTerm = search.trim().toLowerCase();

  if (!searchTerm) {
    return [];
  }

  return rows
    .slice(1)
    .filter((row) => {
      const surname = row[2] ?? "";
      const firstName = row[3] ?? "";
      const middleName = row[4] ?? "";

      const fullName =
        `${firstName} ${middleName} ${surname}`
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      return fullName.includes(searchTerm);
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
      age: row[9] ? Number(row[9]) : null,
      civilStatus: row[10] ?? "",
      contactNumber: row[11] ?? "",
      address: {
        houseBlockLot: row[12] ?? "",
        street: row[13] ?? "",
        subdivisionVillage: row[14] ?? "",
        barangay: row[15] ?? "",
        municipalityCity: row[16] ?? "",
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
          (row[21] ?? "")
            .trim()
            .toLowerCase(),
        ),
        address: {
          houseBlockLot: row[22] ?? "",
          street: row[23] ?? "",
          subdivisionVillage: row[24] ?? "",
          barangay: row[25] ?? "",
          municipalityCity: row[26] ?? "",
          province: row[27] ?? "",
          zipCode: row[28] ?? "",
        },
      },
    }));
}

/**
 * Checks whether a member is already enrolled
 * in the specified program.
 *
 * Duplicate is based on:
 * Member Number + Program ID
 */
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

  for (const row of rows.slice(1)) {
    const rowMemberNumber =
      (row[2] ?? "").trim();

    const rowProgramId =
      (row[3] ?? "").trim();

    if (
      rowMemberNumber === normalizedMemberNumber &&
      rowProgramId === normalizedProgramId
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
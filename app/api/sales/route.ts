import { NextResponse } from "next/server";

import {
  addMember,
  addMemberProgram,
  addSale,
  findMemberByNumber,
  findMemberProgramEnrollment,
  type MemberSheetData,
  type MemberProgramSheetData,
  type SaleSheetData,
} from "@/lib/google-sheets-data";

type SalePayload = {
  branch: string;
  mas: string;
  dateRemitted: string;
  sales: SalePayloadItem[];
};

type SalePayloadItem = {
  memberNumber: string;
  existingMember: boolean;

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
  claimantSameAsMember: boolean;

  claimantAddressHouse: string;
  claimantAddressStreet: string;
  claimantAddressSubdivision: string;
  claimantAddressBarangay: string;
  claimantAddressCity: string;
  claimantAddressProvince: string;
  claimantAddressZip: string;

  applicationNo: string;
  orNumber: string;
  orDate: string;

  paymentMethod: string;
  registrationFee: string;
  registrationAmount: string;
  amountPaid: string;

  doi: string;
  programId: string;
  programTerms: string;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

export async function POST(request: Request) {
  try {
    const body =
      (await request.json()) as SalePayload;

    if (!body.branch?.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Branch is required.",
        },
        { status: 400 },
      );
    }

    if (!body.mas?.trim()) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Marketing Account Staff is required.",
        },
        { status: 400 },
      );
    }

    if (!body.dateRemitted?.trim()) {
      return NextResponse.json(
        {
          success: false,
          message: "Date Remitted is required.",
        },
        { status: 400 },
      );
    }

    if (
      !Array.isArray(body.sales) ||
      body.sales.length === 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message: "At least one sale is required.",
        },
        { status: 400 },
      );
    }

    /*
     * =====================================================
     * STEP 1: PRE-FLIGHT VALIDATION
     * =====================================================
     *
     * Nothing is written to Google Sheets during this step.
     *
     * We first make sure:
     *
     * - Existing members actually exist.
     * - The selected program is not already enrolled.
     * - The same member/program is not repeated
     *   inside this batch.
     */

    type PreparedSale = {
      sale: SalePayloadItem;
      memberId: string;
      memberNumber: string;
      isNewMember: boolean;
    };

    const preparedSales: PreparedSale[] = [];

    const batchPrograms = new Set<string>();

    for (
      let index = 0;
      index < body.sales.length;
      index++
    ) {
      const sale = body.sales[index];

      const saleNumber = index + 1;

      if (!sale) {
        return NextResponse.json(
          {
            success: false,
            message:
              `Sale #${saleNumber} is missing.`,
          },
          { status: 400 },
        );
      }

      const programId =
        sale.programId?.trim() ?? "";

      if (!programId) {
        return NextResponse.json(
          {
            success: false,
            message:
              `Sale #${saleNumber}: Program is required.`,
          },
          { status: 400 },
        );
      }

      /*
       * Existing member
       */
      if (sale.existingMember) {
        const memberNumber =
          sale.memberNumber?.trim() ?? "";

        if (!memberNumber) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Sale #${saleNumber}: Existing member number is required.`,
            },
            { status: 400 },
          );
        }

        const existingMember =
          await findMemberByNumber(
            memberNumber,
          );

        if (!existingMember) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Sale #${saleNumber}: Member ${memberNumber} could not be found.`,
            },
            { status: 409 },
          );
        }

        /*
         * IMPORTANT:
         *
         * Use the actual Member ID from the
         * Members sheet.
         *
         * Do NOT create:
         * MEM-${memberNumber}
         */
        const memberProgramKey =
          `${existingMember.memberNumber}::${programId}`;

        /*
         * Check duplicate inside this batch.
         */
        if (
          batchPrograms.has(
            memberProgramKey,
          )
        ) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Sale #${saleNumber}: This member is already included in this batch for the selected program.`,
              duplicate: true,
              memberNumber:
                existingMember.memberNumber,
              programId,
            },
            { status: 409 },
          );
        }

        /*
         * Check duplicate already stored
         * in Google Sheets.
         */
        const existingEnrollment =
          await findMemberProgramEnrollment(
            existingMember.memberNumber,
            programId,
          );

        if (existingEnrollment) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Sale #${saleNumber}: Member ${existingMember.memberNumber} is already enrolled in program ${programId}.`,
              duplicate: true,
              memberNumber:
                existingMember.memberNumber,
              programId,
              enrollmentId:
                existingEnrollment.enrollmentId,
            },
            { status: 409 },
          );
        }

        batchPrograms.add(
          memberProgramKey,
        );

        preparedSales.push({
          sale,
          memberId:
            existingMember.memberId,
          memberNumber:
            existingMember.memberNumber,
          isNewMember: false,
        });

        continue;
      }

      /*
       * New member
       */
      const memberNumber =
        sale.memberNumber?.trim() ?? "";

      /*
       * New members should not silently reuse
       * an existing member number.
       *
       * If a member number was supplied, verify
       * that it does not already exist.
       */
      if (memberNumber) {
        const existingMember =
          await findMemberByNumber(
            memberNumber,
          );

        if (existingMember) {
          return NextResponse.json(
            {
              success: false,
              message:
                `Sale #${saleNumber}: Member number ${memberNumber} already exists. Please use the existing member option.`,
              duplicate: true,
              memberNumber,
            },
            { status: 409 },
          );
        }
      }

      /*
       * Generate the new member number.
       */
      const generatedMemberNumber =
        memberNumber ||
        `PH-${Date.now()
          .toString()
          .slice(-8)}`;

      const memberId =
        createId("MEM");

      const memberProgramKey =
        `${generatedMemberNumber}::${programId}`;

      /*
       * Check duplicate inside this batch.
       */
      if (
        batchPrograms.has(
          memberProgramKey,
        )
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              `Sale #${saleNumber}: This member/program combination is already included in this batch.`,
            duplicate: true,
            memberNumber:
              generatedMemberNumber,
            programId,
          },
          { status: 409 },
        );
      }

      batchPrograms.add(
        memberProgramKey,
      );

      preparedSales.push({
        sale,
        memberId,
        memberNumber:
          generatedMemberNumber,
        isNewMember: true,
      });
    }

    /*
     * =====================================================
     * STEP 2: ALL CHECKS PASSED
     * =====================================================
     *
     * Only now do we start writing data.
     */

    const savedSales: Array<{
      memberId: string;
      memberNumber: string;
      enrollmentId: string;
      saleId: string;
    }> = [];

    for (const prepared of preparedSales) {
      const {
        sale,
        memberId,
        memberNumber,
        isNewMember,
      } = prepared;

      /*
       * Create Members row only for a new member.
       */
      if (isNewMember) {
        const memberData: MemberSheetData = {
          memberId,
          memberNumber,

          surname: sale.surname,
          firstName: sale.firstName,
          middleName: sale.middleName,
          nameExtension: sale.nameExtension,

          birthdate: sale.birthdate,
          birthplace: sale.birthplace,
          gender: sale.gender,
          age: sale.age,
          civilStatus: sale.civilStatus,
          contactNumber:
            sale.contactNumber,

          addressHouse:
            sale.addressHouse,
          addressStreet:
            sale.addressStreet,
          addressSubdivision:
            sale.addressSubdivision,
          addressBarangay:
            sale.addressBarangay,
          addressCity:
            sale.addressCity,
          addressProvince:
            sale.addressProvince,
          addressZip:
            sale.addressZip,

          claimantName:
            sale.claimantName,
          claimantContact:
            sale.claimantContact,
          claimantSameAsMember:
            sale.claimantSameAsMember
              ? "Yes"
              : "No",

          claimantAddressHouse:
            sale.claimantAddressHouse,
          claimantAddressStreet:
            sale.claimantAddressStreet,
          claimantAddressSubdivision:
            sale.claimantAddressSubdivision,
          claimantAddressBarangay:
            sale.claimantAddressBarangay,
          claimantAddressCity:
            sale.claimantAddressCity,
          claimantAddressProvince:
            sale.claimantAddressProvince,
          claimantAddressZip:
            sale.claimantAddressZip,

          status: "Active",
        };

        await addMember(
          memberData,
        );
      }

      /*
       * Create Member Programs row.
       */
      const enrollmentId =
        createId("ENR");

      const memberProgramData: MemberProgramSheetData =
        {
          enrollmentId,
          memberId,
          memberNumber,

          programId:
            sale.programId,
          doi: sale.doi,

          branch:
            body.branch.trim(),
          mas:
            body.mas.trim(),

          paymentMethod:
            sale.paymentMethod,
          registrationFee:
            sale.registrationFee,
          registrationAmount:
            sale.registrationAmount,
          amountPaid:
            sale.amountPaid,

          programTerms:
            sale.programTerms,

          status: "Active",
          dateCreated:
            new Date().toISOString(),
        };

      await addMemberProgram(
        memberProgramData,
      );

      /*
       * Create Sales row.
       */
      const saleId =
        createId("SALE");

      const saleData: SaleSheetData = {
        saleId,
        dateCreated:
          new Date().toISOString(),

        branch:
          body.branch.trim(),
        mas:
          body.mas.trim(),
        dateRemitted:
          body.dateRemitted.trim(),

        memberNumber,

        surname:
          sale.surname,
        firstName:
          sale.firstName,
        middleName:
          sale.middleName,
        nameExtension:
          sale.nameExtension,

        birthdate:
          sale.birthdate,
        birthplace:
          sale.birthplace,
        gender:
          sale.gender,
        age:
          sale.age,
        civilStatus:
          sale.civilStatus,
        contactNumber:
          sale.contactNumber,

        addressHouse:
          sale.addressHouse,
        addressStreet:
          sale.addressStreet,
        addressSubdivision:
          sale.addressSubdivision,
        addressBarangay:
          sale.addressBarangay,
        addressCity:
          sale.addressCity,
        addressProvince:
          sale.addressProvince,
        addressZip:
          sale.addressZip,

        claimantName:
          sale.claimantName,
        claimantContact:
          sale.claimantContact,
        claimantSameAsMember:
          sale.claimantSameAsMember
            ? "Yes"
            : "No",

        claimantAddressHouse:
          sale.claimantAddressHouse,
        claimantAddressStreet:
          sale.claimantAddressStreet,
        claimantAddressSubdivision:
          sale.claimantAddressSubdivision,
        claimantAddressBarangay:
          sale.claimantAddressBarangay,
        claimantAddressCity:
          sale.claimantAddressCity,
        claimantAddressProvince:
          sale.claimantAddressProvince,
        claimantAddressZip:
          sale.claimantAddressZip,

        programId:
          sale.programId,
        doi:
          sale.doi,

        paymentMethod:
          sale.paymentMethod,
        registrationFee:
          sale.registrationFee,
        registrationAmount:
          sale.registrationAmount,
        amountPaid:
          sale.amountPaid,

        programTerms:
          sale.programTerms,

        applicationNo:
          sale.applicationNo,
        orNumber:
          sale.orNumber,
        orDate:
          sale.orDate,
      };

      await addSale(
        saleData,
      );

      savedSales.push({
        memberId,
        memberNumber,
        enrollmentId,
        saleId,
      });
    }

    return NextResponse.json({
      success: true,
      message:
        "All new sales were saved successfully.",
      savedSales,
    });
  } catch (error: unknown) {
    console.error(
      "Sales API error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to save sales.";

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 },
    );
  }
}
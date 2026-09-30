import { userWithPageAccess } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import {
  addBeneficiaries,
  addMember,
  addMemberProgram,
  addSale,
  findMemberByNumber,
  findMemberProgramEnrollment,
  getBranches,
  getPrograms,
  type MemberSheetData,
  type MemberProgramSheetData,
  type SaleSheetData,
} from "@/lib/google-sheets-data";
import { getEmployees } from "@/lib/employees";
import { ageRestrictionError } from "@/lib/program-age";
import { todayInManila } from "@/lib/account-rules";
import { FIDELITY_CAP, getFidelityData } from "@/lib/fidelity";
import { GOOGLE_SHEET_ID, readingFresh, sheets, withWriteLock } from "@/lib/google-sheets";
import { calculateSaleIncentive } from "@/lib/remittance";
import { headerMatches } from "@/lib/sheet-headers";

const peso = (value: number) => value.toLocaleString("en-PH", { style: "currency", currency: "PHP" });

type SalePayload = {
  branch: string;
  mas: string;
  dateRemitted: string;
  sales: SalePayloadItem[];
  /** Optional remittance penalty on the batch, charged to the MAS, with what it is for. */
  penalty?: number;
  penaltyNote?: string;
  /** MAS Fidelity for this batch; it comes out of the batch's New Sale incentives. Zero is allowed. */
  fidelityAmount?: number;
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

  claimantName: string;
  claimantContact: string;
  claimantSameAsMember: boolean;

  claimantAddressHouse: string;

  applicationNo: string;
  orDate: string;

  paymentMethod: string;
  registrationFee: string;
  registrationAmount: string;
  amountPaid: string;

  doi: string;
  programId: string;
  programTerms: string;
  beneficiaries?: Array<{
    id?: string;
    surname: string;
    firstName: string;
    middleName: string;
    birthdate: string;
    age: number | null;
    relationship: string;
  }>;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

// Generated member numbers keep the PH-######## format but always increase, so two new members saved in the same
// millisecond (in one batch, or by two users) never share a number.
const numbering = globalThis as typeof globalThis & { dayongLastMemberNumber?: number };
function nextMemberNumber() {
  const candidate = Number(Date.now().toString().slice(-8));
  numbering.dayongLastMemberNumber = Math.max(candidate, (numbering.dayongLastMemberNumber ?? 0) + 1) % 100_000_000;
  return `PH-${String(numbering.dayongLastMemberNumber).padStart(8, "0")}`;
}

export const POST = withEncoder(async function POST(request: Request) {
  if (!(await userWithPageAccess("/new-sales"))) return NextResponse.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
  // One sale batch at a time per server, so duplicate-member and enrollment checks see each other's saves.
  return withWriteLock("sales", () => saveSales(request));
});

async function saveSales(request: Request) {
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

    const [branches, employees, programs] = await Promise.all([
      getBranches(),
      getEmployees(),
      getPrograms(),
    ]);
    const selectedBranch = branches.find(
      (branch) => branch.name === body.branch.trim() && branch.status === "active",
    );
    const selectedStaff = employees.find(
      (employee) =>
        employee.name === body.mas.trim() &&
        employee.status === "active" &&
        selectedBranch &&
        employee.branchIds.includes(selectedBranch.id),
    );
    if (!selectedBranch || !selectedStaff) {
      return NextResponse.json(
        { success: false, message: "Select an active employee assigned to the selected branch." },
        { status: 400 },
      );
    }

    // A remittance penalty is charged to the MAS (their own money), added once to this batch's remittance.
    const penalty = Math.round((Number(body.penalty) || 0) * 100) / 100;
    const penaltyNote = typeof body.penaltyNote === "string" ? body.penaltyNote.trim() : "";
    if (!Number.isFinite(penalty) || penalty < 0) return NextResponse.json({ success: false, message: "The penalty must be zero or a positive amount." }, { status: 400 });
    if (penalty > 0 && penaltyNote.length < 3) return NextResponse.json({ success: false, message: "Explain what the penalty is for (at least 3 characters)." }, { status: 400 });
    if (penaltyNote.length > 300) return NextResponse.json({ success: false, message: "The penalty note must be 300 characters or fewer." }, { status: 400 });
    const fidelity = Math.round((Number(body.fidelityAmount) || 0) * 100) / 100;
    if (!Number.isFinite(fidelity) || fidelity < 0) return NextResponse.json({ success: false, message: "Fidelity must be zero or a positive amount." }, { status: 400 });

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

      const selectedProgram = programs.find(
        (program) => program.id === programId && program.status === "active",
      );
      if (!selectedProgram) {
        return NextResponse.json(
          { success: false, message: `Sale #${saleNumber}: Select an active program.` },
          { status: 400 },
        );
      }
      // Age-restricted programs: check the member's age today, using the stored birthdate for existing members.
      const memberBirthdate = sale.existingMember
        ? (await findMemberByNumber(sale.memberNumber?.trim() ?? ""))?.birthdate ?? ""
        : sale.birthdate;
      const ageError = ageRestrictionError(selectedProgram, memberBirthdate, todayInManila());
      if (ageError) {
        return NextResponse.json(
          { success: false, message: `Sale #${saleNumber}: ${ageError}` },
          { status: 400 },
        );
      }
      sale.registrationFee = selectedProgram.registrationFeeRequired ? "Yes" : "No";
      sale.registrationAmount = String(
        selectedProgram.registrationFeeRequired ? selectedProgram.registrationAmount : 0,
      );

      for (const beneficiary of sale.beneficiaries ?? []) {
        if (!beneficiary.surname?.trim() || !beneficiary.firstName?.trim() || !beneficiary.relationship?.trim()) {
          return NextResponse.json(
            { success: false, message: `Sale #${saleNumber}: Each beneficiary needs a surname, first name, and relationship.` },
            { status: 400 },
          );
        }
      }

      if (!sale.applicationNo?.trim()) {
        return NextResponse.json(
          { success: false, message: `Sale #${saleNumber}: Application Number is required.` },
          { status: 400 },
        );
      }

      if (
        !sale.addressHouse?.trim()
      ) {
        return NextResponse.json(
          {
            success: false,
            message:
              `Sale #${saleNumber}: Complete Address is required.`,
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
      let generatedMemberNumber = memberNumber;
      if (!generatedMemberNumber) {
        // Never reuse a number: skip any already on record or already given out.
        do generatedMemberNumber = nextMemberNumber();
        while (await findMemberByNumber(generatedMemberNumber));
      }

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
     * What the MAS keeps from each sale and what the company is owed (lib/remittance.ts calculateSaleIncentive).
     * The batch's Fidelity comes out of these incentives and is added to the remittance.
     */
    const quotes: Array<{ incentive: number; remittance: number }> = [];
    for (const [index, prepared] of preparedSales.entries()) {
      const program = programs.find((item) => item.id === prepared.sale.programId?.trim());
      const amountPaid = Number(prepared.sale.amountPaid);
      if (!program || !Number.isFinite(amountPaid) || amountPaid < 0) return NextResponse.json({ success: false, message: `Sale #${index + 1}: Enter a valid amount paid.` }, { status: 400 });
      try { quotes.push(calculateSaleIncentive(program, amountPaid)); }
      catch (error) { return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${error instanceof Error ? error.message : "The incentive could not be calculated."}` }, { status: 400 }); }
    }
    if (fidelity > 0) {
      const incentives = Math.round(quotes.reduce((sum, quote) => sum + Math.round(quote.incentive * 100), 0)) / 100;
      if (fidelity > incentives) return NextResponse.json({ success: false, message: `Fidelity cannot exceed the batch's total incentives of ${peso(incentives)}.` }, { status: 400 });
      const account = (await getFidelityData(selectedStaff.id, true)).accounts.find((item) => item.masEmployeeId === selectedStaff.id);
      const remaining = Math.max(0, Math.round((FIDELITY_CAP - (account?.approved ?? 0) - (account?.pending ?? 0)) * 100) / 100);
      if (fidelity > remaining) return NextResponse.json({ success: false, message: `Fidelity can be at most ${peso(remaining)} for this MAS (the ${peso(FIDELITY_CAP)} limit).` }, { status: 400 });
    }
    const salesHeader = (await readingFresh(() => sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Sales!AO1:AQ1" }))).data.values?.[0] ?? [];
    if (["mas_incentive", "remittance_amount", "fidelity_amount"].some((name, index) => !headerMatches(salesHeader[index], name))) {
      return NextResponse.json({ success: false, message: "Run npm run sheets:sale-incentives -- --apply to add the New Sales incentive and Fidelity columns before saving." }, { status: 400 });
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
        orNumber: "",
        orDate:
          sale.orDate,
      };

      const quote = quotes[savedSales.length];
      await addSale(
        saleData,
        selectedStaff.id,
        savedSales.length === 0 ? { amount: penalty, note: penaltyNote } : undefined,
        { ...quote, fidelity: savedSales.length === 0 ? fidelity : 0 },
      );

      await addBeneficiaries(memberId, saleId, sale.beneficiaries ?? []);

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

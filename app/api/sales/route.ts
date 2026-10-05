import { userWithPageAccess } from "@/lib/auth-server";
import { fixedNewSaleAmount } from "@/lib/program-amount-lock";
import { checkBackdate, controlTotalProblem } from "@/lib/entry-controls";
import { blockingDateProblem } from "@/lib/date-checks";
import { manilaNow } from "@/lib/remittance-deadline";
import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { addBeneficiaries, addMember, addMemberProgram, addSale, findMemberByNumber, findMemberProgramEnrollment, updateMemberDetails, type MemberDetails, type MemberSheetData, type MemberProgramSheetData, type SaleSheetData } from "@/lib/member-records";
import { getEmployees } from "@/lib/employees";
import { ageRestrictionError } from "@/lib/program-age";
import { todayInManila } from "@/lib/account-rules";
import { inTransaction, isUniqueViolation } from "@/lib/db";
import { calculateSaleIncentive, tiersForBranch } from "@/lib/remittance";
import { newSalesDoubleEntry, personKey } from "@/lib/duplicate-entries";


type SalePayload = {
  branch: string;
  mas: string;
  dateRemitted: string;
  sales: SalePayloadItem[];
  /** The total written on the MAS's turnover sheet; the batch must add up to it exactly. */
  controlTotal?: number | string;
  /** Optional remittance penalty on the batch, charged to the MAS, with what it is for. */
  penalty?: number;
  penaltyNote?: string;
  /** Fidelity for this batch: the MAS's own money, added to the total remittance. No limit; zero is allowed. */
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
  /** Required when the application date is more than a day old (lib/entry-controls.ts). */
  backdateReason?: string;

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

/** Compares Philippine mobile numbers regardless of spaces, dashes, or a +63 prefix; blank when no usable number. */
function phoneKey(value: unknown) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("63")) digits = `0${digits.slice(2)}`;
  return digits.length >= 10 ? digits : "";
}

export const POST = withEncoder(async function POST(request: Request) {
  if (!(await userWithPageAccess("/new-sales"))) return NextResponse.json({ success: false, message: "You do not have access to New Sales." }, { status: 403 });
  return saveSales(request);
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

    // A remittance penalty is charged to the MAS (their own money), recorded once on this batch, separate from the remittance.
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

    // A member's or claimant's contact number may not be any employee's number (e.g. the MAS's own phone).
    const employeeContacts = new Map(employees.map((employee) => [phoneKey(employee.contact), employee] as const).filter(([key]) => key));
    for (const [index, sale] of body.sales.entries()) {
      for (const [label, contact] of [["Member", sale?.contactNumber], ["Claimant", sale?.claimantContact]] as const) {
        const employee = employeeContacts.get(phoneKey(contact));
        if (employee) return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${label} contact number ${String(contact).trim()} belongs to employee ${employee.name} (${employee.id}). Use the member's or claimant's own number.` }, { status: 400 });
      }
    }

    // Double entries: an Application Number used before, or a person already on record registered again as new.
    const doubleEntry = await newSalesDoubleEntry(body.sales.filter(Boolean));
    if (doubleEntry) return NextResponse.json({ success: false, duplicate: true, message: doubleEntry }, { status: 409 });

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
      /** A later program for a new member registered earlier in this batch: the member row is created once. */
      sharesNewMember?: boolean;
    };

    const preparedSales: PreparedSale[] = [];

    const batchPrograms = new Set<string>();

    // New members registered in this batch, by person, so one new member can enroll in several programs at once.
    const batchNewMembers = new Map<string, { memberId: string; memberNumber: string }>();

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
      // Age-restricted programs: check the member's age today. An existing member's corrected birthdate is saved to their
      // record with this sale, so it applies; a blank one keeps the stored birthdate.
      const memberBirthdate = sale.existingMember && !sale.birthdate?.trim()
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

      // The same new person on an earlier sale in this batch: enroll them in this program too, under that member.
      const person = personKey(sale);
      const sameNewMember = person ? batchNewMembers.get(person) : undefined;

      /*
       * Generate the new member number.
       */
      let generatedMemberNumber = sameNewMember?.memberNumber || memberNumber;
      if (!generatedMemberNumber) {
        // Never reuse a number: skip any already on record or already given out.
        do generatedMemberNumber = nextMemberNumber();
        while (await findMemberByNumber(generatedMemberNumber));
      }

      const memberId =
        sameNewMember?.memberId ?? createId("MEM");
      if (person && !sameNewMember) batchNewMembers.set(person, { memberId, memberNumber: generatedMemberNumber });

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
              `Sale #${saleNumber}: This member is already enrolled in this program earlier in this batch.`,
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
        sharesNewMember: Boolean(sameNewMember),
      });
    }

    /*
     * What the MAS keeps from each sale and what the company is owed (lib/remittance.ts calculateSaleIncentive).
     * The batch's Fidelity is the MAS's own money: it leaves these incentives untouched and is added to the remittance.
     */
    // The batch must add up to the total on the MAS's turnover sheet, and late application dates need a reason.
    const controlProblem = controlTotalProblem(body.controlTotal, preparedSales.map((prepared) => Number(prepared.sale.amountPaid) || 0));
    if (controlProblem) return NextResponse.json({ success: false, message: controlProblem }, { status: 400 });
    for (const [index, prepared] of preparedSales.entries()) {
      const dateProblem = blockingDateProblem({ receiptDate: String(prepared.sale.orDate ?? "").trim(), receiptLabel: "application date", dateRemitted: String(body.dateRemitted ?? "").trim(), today: manilaNow().date });
      if (dateProblem) return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${dateProblem}` }, { status: 400 });
      try { checkBackdate(String(prepared.sale.orDate ?? "").trim(), String(prepared.sale.backdateReason ?? ""), `Sale #${index + 1}`); }
      catch (error) { return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Enter the reason for the late date." }, { status: 400 }); }
    }
    const quotes: Array<{ incentive: number; remittance: number }> = [];
    for (const [index, prepared] of preparedSales.entries()) {
      const program = programs.find((item) => item.id === prepared.sale.programId?.trim());
      const amountPaid = Number(prepared.sale.amountPaid);
      if (!program || !Number.isFinite(amountPaid) || amountPaid < 0) return NextResponse.json({ success: false, message: `Sale #${index + 1}: Enter a valid amount paid.` }, { status: 400 });
      // Programs whose New Sale amount is locked accept only their fixed amount.
      // A flexible program takes any amount from its minimum (plus any registration fee).
      if (program.flexible && Math.round(amountPaid * 100) < Math.round(fixedNewSaleAmount(program) * 100)) {
        return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${program.name} needs at least ${fixedNewSaleAmount(program).toLocaleString("en-PH", { style: "currency", currency: "PHP" })} (the minimum monthly payment).` }, { status: 400 });
      }
      if (!program.flexible && !program.newSaleAmountEditable && Math.round(amountPaid * 100) !== Math.round(fixedNewSaleAmount(program) * 100)) {
        return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${program.name} has a fixed amount of ${fixedNewSaleAmount(program).toLocaleString("en-PH", { style: "currency", currency: "PHP" })}. Ask an administrator to allow editing in Programs if this receipt is different.` }, { status: 400 });
      }
      // A branch's own incentive tiers replace the program's base tiers there.
      try { quotes.push(calculateSaleIncentive({ ...program, incentiveTiers: tiersForBranch(program.incentiveTiers, selectedBranch?.id ?? "") }, amountPaid)); }
      catch (error) { return NextResponse.json({ success: false, message: `Sale #${index + 1}: ${error instanceof Error ? error.message : "The incentive could not be calculated."}` }, { status: 400 }); }
    }

    /*
     * =====================================================
     * STEP 2: ALL CHECKS PASSED
     * =====================================================
     *
     * Only now do we start writing data, all in one transaction: the batch saves completely or not at all. Unique
     * rules in the database (member number, Application Number, one enrollment per member and program) stop a racing
     * save that passed the checks above at the same moment.
     */

    const savedSales: Array<{
      memberId: string;
      memberNumber: string;
      enrollmentId: string;
      saleId: string;
    }> = [];

    await inTransaction(async () => {
      for (const prepared of preparedSales) {
        const {
          sale,
          memberId,
          memberNumber,
          isNewMember,
          sharesNewMember,
        } = prepared;

        const details: MemberDetails = {
          surname: sale.surname, firstName: sale.firstName, middleName: sale.middleName, nameExtension: sale.nameExtension,
          birthdate: sale.birthdate, birthplace: sale.birthplace, gender: sale.gender, age: sale.age, civilStatus: sale.civilStatus,
          contactNumber: sale.contactNumber, addressHouse: sale.addressHouse, claimantName: sale.claimantName, claimantContact: sale.claimantContact,
          claimantSameAsMember: sale.claimantSameAsMember ? "Yes" : "No", claimantAddressHouse: sale.claimantAddressHouse,
        };
        // An existing member's details as confirmed or corrected on this sale become their current record.
        if (!isNewMember) await updateMemberDetails(memberId, details);

        /*
         * Create Members row only for a new member, once per person in the batch.
         */
        if (isNewMember && !sharesNewMember) {
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
          backdateReason: String(sale.backdateReason ?? "").trim().slice(0, 300),
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
    });

    return NextResponse.json({
      success: true,
      message:
        "All new sales were saved successfully.",
      savedSales,
    });
  } catch (error: unknown) {
    const conflict = isUniqueViolation(error, "sales_application_key_unique") ? "An Application Number in this batch was just recorded by another save."
      : isUniqueViolation(error, "members_member_number_key") ? "A member number in this batch was just used by another save."
      : isUniqueViolation(error, "member_programs_member_program_key") ? "A member in this batch was just enrolled in the same program by another save."
      : "";
    if (conflict) return NextResponse.json({ success: false, duplicate: true, message: `${conflict} Nothing was saved; check the batch and try again.` }, { status: 409 });
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

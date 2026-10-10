import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";
import { canManageConfiguration } from "@/lib/auth-server";
import { deleteProgramRecord, type ProgramBulkChanges, type ProgramInput, updateProgramRecord, updateProgramsBulk } from "@/lib/master-data-crud";
import { validateIncentiveTiers } from "@/lib/program-incentive-store";
import { programSnapshot } from "@/lib/program-snapshot";
import { normalizeMonthlyMaximum } from "@/lib/program-payment-limit.mjs";

import {
  createProgram,
  getPrograms,
} from "@/lib/google-sheets-data";

type IncentiveRole = "MAS" | "Collector";
type IncentiveType = "fixed" | "percentage";

type IncentiveTier = {
  role: IncentiveRole;
  fromMonth: number;
  toMonth: number;
  incentiveType: IncentiveType;
  markUp: number;
  incentiveAmount: number;
  /** Blank = base tier for all branches; otherwise a tier for that branch only. */
  branchId?: string;
};

export async function GET() {
  try {
    const programs = await getPrograms();

    return NextResponse.json({
      success: true,
      programs,
      canManage: await canManageConfiguration(),
    });
  } catch (error) {
    console.error(
      "Get programs error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load programs.",
      },
      {
        status: 500,
      },
    );
  }
}

export const POST = withEncoder(async function POST(
  request: Request,
) {
  if (!(await canManageConfiguration())) return NextResponse.json({ success: false, error: "You are not allowed to create programs." }, { status: 403 });
  try {
    const body = await request.json();

    const {
      code,
      name,
      basePay,
      incentiveTiers,
      description,
      status,
      registrationFeeRequired,
      registrationAmount,
      payBalanceTotal,
    } = body;

    if (
      typeof code !== "string" ||
      !code.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Program code is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof name !== "string" ||
      !name.trim()
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Program name is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof basePay !== "number" ||
      !Number.isFinite(basePay) ||
      basePay <= 0
    ) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Base pay must be greater than 0.",
        },
        {
          status: 400,
        },
      );
    }

    const normalizedRegistrationAmount = Number(registrationAmount) || 0;
    const normalizedPayBalanceTotal = Number(payBalanceTotal) || 0;
    if (normalizedRegistrationAmount < 0 || normalizedPayBalanceTotal < 0 || (registrationFeeRequired && normalizedRegistrationAmount <= 0)) {
      return NextResponse.json({ success: false, error: "Enter a valid registration amount and total amount payable." }, { status: 400 });
    }

    if (!Array.isArray(incentiveTiers)) {
      return NextResponse.json(
        {
          success: false,
          error:
            "At least one incentive tier is required.",
        },
        {
          status: 400,
        },
      );
    }

    const normalizedTiers: IncentiveTier[] =
      incentiveTiers.map(
        (tier: IncentiveTier) => ({
          role:
            tier.role === "Collector"
              ? "Collector"
              : "MAS",

          fromMonth: Number(
            tier.fromMonth,
          ),

          toMonth: Number(
            tier.toMonth,
          ),

          incentiveType:
            tier.incentiveType === "fixed"
              ? "fixed"
              : "percentage",

          markUp:
            Number(tier.markUp) || 0,

          incentiveAmount: Number(
            tier.incentiveAmount,
          ),

          branchId: typeof tier.branchId === "string" ? tier.branchId.trim() : "",
        }),
      );

    if (normalizedTiers.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "At least one incentive tier is required.",
        },
        {
          status: 400,
        },
      );
    }

    for (const tier of normalizedTiers) {
      if (
        !Number.isInteger(
          tier.fromMonth,
        ) ||
        tier.fromMonth < 1
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Incentive starting month must be at least 1.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        !Number.isInteger(
          tier.toMonth,
        ) ||
        tier.toMonth <
          tier.fromMonth
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Incentive ending month must be greater than or equal to the starting month.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        !Number.isFinite(
          tier.markUp,
        ) ||
        tier.markUp < 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Mark Up cannot be negative.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        tier.markUp > basePay
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Mark Up cannot be greater than Base Pay.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        !Number.isFinite(
          tier.incentiveAmount,
        ) ||
        tier.incentiveAmount < 0
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Incentive amount cannot be negative.",
          },
          {
            status: 400,
          },
        );
      }

      if (
        tier.incentiveType ===
          "percentage" &&
        tier.incentiveAmount > 100
      ) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Percentage incentive cannot be greater than 100%.",
          },
          {
            status: 400,
          },
        );
      }
    }

    /*
     * Check for overlapping tiers
     * belonging to the same role.
     */
    for (
      let i = 0;
      i < normalizedTiers.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < normalizedTiers.length;
        j++
      ) {
        const first =
          normalizedTiers[i];

        const second =
          normalizedTiers[j];

        if (
          first.role ===
            second.role &&
          (first.branchId ?? "") === (second.branchId ?? "") &&
          first.fromMonth <=
            second.toMonth &&
          second.fromMonth <=
            first.toMonth
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                `Incentive tiers for ${first.role} ${first.branchId ? `in branch ${first.branchId}` : "for all branches"} cannot overlap.`,
            },
            {
              status: 400,
            },
          );
        }
      }
    }

    const normalizedStatus =
      status === "inactive"
        ? "inactive"
        : "active";

    const normalizedDescription =
      typeof description === "string"
        ? description.trim()
        : "";

    try {
      normalizeMonthlyMaximum({ flexible: body.flexible === true, basePay, maxMonthlyPayment: body.maxMonthlyPayment });
      await validateIncentiveTiers(normalizedTiers, basePay);
    }
    catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Invalid incentive tiers." }, { status: 400 }); }

    const program =
      await createProgram({
        code: code.trim(),
        name: name.trim(),
        basePay,

        incentiveTiers:
          normalizedTiers,
        categoryId: typeof body.categoryId === "string" ? body.categoryId.trim() : "",
        newSaleAmountEditable: body.newSaleAmountEditable === true,
        collectionAmountEditable: body.collectionAmountEditable === true,
        flexible: body.flexible === true,
        maxMonthlyPayment: body.maxMonthlyPayment,

        description:
          normalizedDescription,

        status: normalizedStatus,
        registrationFeeRequired: Boolean(registrationFeeRequired),
        registrationAmount: normalizedRegistrationAmount,
        payBalanceTotal: normalizedPayBalanceTotal,
        saleIncentiveType: body.saleIncentiveType,
        saleIncentiveAmount: body.saleIncentiveAmount,
        ageRestricted: body.ageRestricted,
        minAge: body.minAge,
        maxAge: body.maxAge,
      });

    return NextResponse.json(
      {
        success: true,
        program,
      },
      {
        status: 201,
      },
    );
  } catch (error) {
    console.error(
      "Create program error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save program.",
      },
      {
        status: 500,
      },
    );
  }
});

function programInput(body: Record<string, unknown>): ProgramInput {
  const tiers = Array.isArray(body.incentiveTiers) ? body.incentiveTiers : [];
  return {
    code: typeof body.code === "string" ? body.code.trim() : "",
    name: typeof body.name === "string" ? body.name.trim() : "",
    basePay: Number(body.basePay),
    status: body.status === "inactive" ? "inactive" : "active",
    description: typeof body.description === "string" ? body.description.trim() : "",
    categoryId: typeof body.categoryId === "string" ? body.categoryId.trim() : "",
    newSaleAmountEditable: body.newSaleAmountEditable === true,
    collectionAmountEditable: body.collectionAmountEditable === true,
    flexible: body.flexible === true,
    maxMonthlyPayment: body.maxMonthlyPayment,
    registrationFeeRequired: Boolean(body.registrationFeeRequired),
    registrationAmount: Number(body.registrationAmount) || 0,
    payBalanceTotal: Number(body.payBalanceTotal) || 0,
    saleIncentiveType: body.saleIncentiveType,
    saleIncentiveAmount: body.saleIncentiveAmount,
    ageRestricted: body.ageRestricted,
    minAge: body.minAge,
    maxAge: body.maxAge,
    incentiveTiers: tiers.map((value) => { const tier = value as Record<string, unknown>; return { role: tier.role === "Collector" ? "Collector" : "MAS", fromMonth: Number(tier.fromMonth), toMonth: Number(tier.toMonth), incentiveType: tier.incentiveType === "fixed" ? "fixed" : "percentage", markUp: Number(tier.markUp), incentiveAmount: Number(tier.incentiveAmount), branchId: typeof tier.branchId === "string" ? tier.branchId.trim() : "", nonCommissionable: tier.nonCommissionable === true }; }),
  };
}

export const PUT = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return NextResponse.json({ success: false, error: "You are not allowed to update programs." }, { status: 403 });
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    const body = await request.json();
    // A form left open must not write its older values over a newer edit (October 10, 2026, "my edit is gone").
    if (typeof body.expectedSnapshot === "string") {
      const current = (await getPrograms()).find((program) => program.id === id);
      if (current && programSnapshot(current) !== body.expectedSnapshot) {
        return NextResponse.json({ success: false, error: "This program was changed by someone else after you opened it, so your save was stopped to keep their change. Close the form, open the program again to see the latest settings, then make your change." }, { status: 409 });
      }
    }
    return NextResponse.json({ success: true, program: await updateProgramRecord(id, programInput(body)) });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update program." }, { status: 400 }); }
});

/** Bulk edit: { ids: string[], changes } sets the same settings on every selected program (lib/master-data-crud.ts). */
export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return NextResponse.json({ success: false, error: "You are not allowed to update programs." }, { status: 403 });
  try {
    const body = await request.json() as { ids?: unknown; changes?: Record<string, unknown> };
    const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
    const input = body.changes ?? {};
    const yes = (value: unknown) => value === true;
    const optionalNumber = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));
    const changes: ProgramBulkChanges = {};
    if ("categoryId" in input) changes.categoryId = typeof input.categoryId === "string" ? input.categoryId.trim() : "";
    if ("status" in input) changes.status = input.status === "inactive" ? "inactive" : "active";
    if ("newSaleAmountEditable" in input) changes.newSaleAmountEditable = yes(input.newSaleAmountEditable);
    if ("collectionAmountEditable" in input) changes.collectionAmountEditable = yes(input.collectionAmountEditable);
    if ("flexible" in input) changes.flexible = yes(input.flexible);
    if ("maxMonthlyPayment" in input) changes.maxMonthlyPayment = optionalNumber(input.maxMonthlyPayment);
    if (input.registration && typeof input.registration === "object") { const value = input.registration as Record<string, unknown>; changes.registration = { required: yes(value.required), amount: Number(value.amount) || 0 }; }
    if (input.age && typeof input.age === "object") { const value = input.age as Record<string, unknown>; changes.age = { restricted: yes(value.restricted), minAge: optionalNumber(value.minAge), maxAge: optionalNumber(value.maxAge) }; }
    if (input.saleIncentive && typeof input.saleIncentive === "object") { const value = input.saleIncentive as Record<string, unknown>; changes.saleIncentive = { type: value.type === "fixed" || value.type === "percentage" ? value.type : "", amount: Number(value.amount) || 0 }; }
    const result = await updateProgramsBulk(ids, changes);
    return NextResponse.json({ success: true, ...result });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update programs." }, { status: 400 }); }
});

export const DELETE = withEncoder(async (request: Request) => {
  if (!(await canManageConfiguration())) return NextResponse.json({ success: false, error: "You are not allowed to delete programs." }, { status: 403 });
  try {
    const id = new URL(request.url).searchParams.get("id")?.trim() ?? "";
    await deleteProgramRecord(id);
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to delete program." }, { status: 400 }); }
});

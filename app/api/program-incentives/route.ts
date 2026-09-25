import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

import {
  addProgramIncentive,
  getProgramIncentives,
} from "@/lib/google-sheets-data";

export async function GET(
  request: Request,
) {
  try {
    const { searchParams } =
      new URL(request.url);

    const programId =
      searchParams.get("programId") ??
      undefined;

    const incentives =
      await getProgramIncentives(programId);

    return NextResponse.json({
      success: true,
      incentives,
    });
  } catch (error) {
    console.error(
      "Get program incentives error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "Unable to load program incentives.",
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
  try {
    const body = await request.json();

    const {
      id,
      programId,
      role,
      fromMonth,
      toMonth,
      incentiveType,
      markUp,
      incentiveAmount,
    } = body;

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Incentive ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (!programId) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Program ID is required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      role !== "MAS" &&
      role !== "Collector"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Role must be MAS or Collector.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof fromMonth !== "number" ||
      fromMonth < 1
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "From Month must be at least 1.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof toMonth !== "number" ||
      toMonth < fromMonth
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "To Month cannot be less than From Month.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      incentiveType !== "fixed" &&
      incentiveType !== "percentage"
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Invalid incentive type.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof markUp !== "number" ||
      markUp < 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Mark Up cannot be negative.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      typeof incentiveAmount !== "number" ||
      incentiveAmount < 0
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Incentive amount cannot be negative.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      incentiveType === "percentage" &&
      incentiveAmount > 100
    ) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Percentage incentive cannot be greater than 100%.",
        },
        {
          status: 400,
        },
      );
    }

    /*
     * Prevent a Mark Up that is greater
     * than the program base pay.
     *
     * The actual base pay is stored
     * in the Programs sheet, so this
     * route only validates that Mark Up
     * itself is a valid non-negative value.
     */

    const existingIncentives =
      await getProgramIncentives(
        String(programId),
      );

    const hasOverlap =
      existingIncentives.some(
        (incentive) =>
          incentive.role === role &&
          fromMonth <= incentive.toMonth &&
          toMonth >= incentive.fromMonth,
      );

    if (hasOverlap) {
      return NextResponse.json(
        {
          success: false,
          message:
            "This incentive month range overlaps an existing incentive for the same role.",
        },
        {
          status: 409,
        },
      );
    }

    const incentive = {
      id: String(id),
      programId: String(programId),
      role,
      fromMonth,
      toMonth,
      incentiveType,
      markUp,
      incentiveAmount,
    };

    await addProgramIncentive({
      id: String(id),
      programId: String(programId),
      role,
      fromMonth,
      toMonth,
      incentiveType,
      markUp,
      incentiveAmount,
    });

    return NextResponse.json({
      success: true,
      incentive,
    });
  } catch (error) {
    console.error(
      "Add program incentive error:",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        message:
          "Unable to save program incentive.",
      },
      {
        status: 500,
      },
    );
  }
});
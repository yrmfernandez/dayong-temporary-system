import { withEncoder } from "@/lib/encoder-context";
import { NextResponse } from "next/server";

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
};

export async function GET() {
  try {
    const programs = await getPrograms();

    return NextResponse.json({
      success: true,
      programs,
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
  try {
    const body = await request.json();

    const {
      code,
      name,
      basePay,
      incentiveTiers,
      description,
      status,
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
          first.fromMonth <=
            second.toMonth &&
          second.fromMonth <=
            first.toMonth
        ) {
          return NextResponse.json(
            {
              success: false,
              error:
                `Incentive tiers for ${first.role} cannot overlap.`,
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

    const program =
      await createProgram({
        code: code.trim(),
        name: name.trim(),
        basePay,

        incentiveTiers:
          normalizedTiers,

        description:
          normalizedDescription,

        status: normalizedStatus,
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
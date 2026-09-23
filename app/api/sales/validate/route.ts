import { NextResponse } from "next/server";

import {
  findMemberByNumber,
  findMemberProgramEnrollment,
} from "@/lib/google-sheets-data";

type SaleValidationPayload = {
  existingMember: boolean;
  memberNumber: string;
  programId: string;
};

type ValidationBatchPayload = {
  branch: string;
  mas: string;
  dateRemitted: string;
  sales: SaleValidationPayload[];
};

export async function POST(
  request: Request,
) {
  try {
    const body =
      (await request.json()) as ValidationBatchPayload;

    if (!body.branch) {
      return NextResponse.json(
        {
          success: false,
          message: "Branch is required.",
        },
        { status: 400 },
      );
    }

    if (!body.mas) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Marketing Account Staff is required.",
        },
        { status: 400 },
      );
    }

    if (!body.dateRemitted) {
      return NextResponse.json(
        {
          success: false,
          message:
            "Date Remitted is required.",
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
          message:
            "At least one sale is required.",
        },
        { status: 400 },
      );
    }

    for (
      let index = 0;
      index < body.sales.length;
      index++
    ) {
      const sale = body.sales[index];

      if (!sale.programId) {
        return NextResponse.json(
          {
            success: false,
            message: `Sale #${
              index + 1
            }: Program is required.`,
          },
          { status: 400 },
        );
      }

      /*
       * New members cannot already have an
       * enrollment because they do not exist
       * in the database yet.
       */
      if (!sale.existingMember) {
        continue;
      }

      if (!sale.memberNumber) {
        return NextResponse.json(
          {
            success: false,
            message: `Sale #${
              index + 1
            }: Existing member number is missing.`,
          },
          { status: 400 },
        );
      }

      const member =
        await findMemberByNumber(
          sale.memberNumber,
        );

      if (!member) {
        return NextResponse.json(
          {
            success: false,
            message: `Sale #${
              index + 1
            }: Member ${
              sale.memberNumber
            } could not be found.`,
          },
          { status: 400 },
        );
      }

      const enrollment =
        await findMemberProgramEnrollment(
          member.memberId,
          sale.programId,
        );

      if (enrollment) {
        return NextResponse.json(
          {
            success: false,
            duplicate: true,
            saleIndex: index,
            message:
              `Sale #${index + 1}: This member is already enrolled in program "${sale.programId}". ` +
              "This sale cannot be saved.",
          },
          { status: 409 },
        );
      }
    }

    /*
     * Also prevent the same existing member +
     * program from appearing twice in one batch.
     */
    const batchKeys = new Set<string>();

    for (
      let index = 0;
      index < body.sales.length;
      index++
    ) {
      const sale = body.sales[index];

      if (!sale.existingMember) {
        continue;
      }

      const member =
        await findMemberByNumber(
          sale.memberNumber,
        );

      if (!member) {
        continue;
      }

      const key =
        `${member.memberId}::${sale.programId}`;

      if (batchKeys.has(key)) {
        return NextResponse.json(
          {
            success: false,
            duplicate: true,
            saleIndex: index,
            message:
              `Sale #${index + 1}: The same member and program appear more than once in this batch.`,
          },
          { status: 409 },
        );
      }

      batchKeys.add(key);
    }

    return NextResponse.json({
      success: true,
      message:
        "All sales passed validation.",
    });
  } catch (error: unknown) {
    console.error(
      "Sales validation error:",
      error,
    );

    const message =
      error instanceof Error
        ? error.message
        : "Unable to validate new sales.";

    return NextResponse.json(
      {
        success: false,
        message,
      },
      { status: 500 },
    );
  }
}
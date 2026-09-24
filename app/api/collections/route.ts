import { NextResponse } from "next/server";

import {
  addCollections,
  addRemittance,
  findMemberByNumber,
  findMemberProgramEnrollment,
  getCollectionHistory,
} from "@/lib/google-sheets-data";

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function isMonth(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

function countMonths(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth + 1;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get("memberId")?.trim() ?? "";
    const programId = searchParams.get("programId")?.trim() ?? "";

    if (!memberId || !programId) {
      return NextResponse.json({ success: true, history: [] });
    }

    const history = await getCollectionHistory(memberId, programId);

    return NextResponse.json({ success: true, history });
  } catch (error) {
    console.error("Load collection history error:", error);
    return NextResponse.json({ success: false, message: "Unable to load collection history." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const branch = typeof body.branch === "string" ? body.branch.trim() : "";
    const mas = typeof body.mas === "string" ? body.mas.trim() : "";
    const dateRemitted = typeof body.dateRemitted === "string" ? body.dateRemitted.trim() : "";
    const entries = Array.isArray(body.collections) ? body.collections : [];

    if (!branch || !mas || !dateRemitted || entries.length === 0) {
      return NextResponse.json({ success: false, message: "Branch, MAS, Date Remitted, and at least one collection are required." }, { status: 400 });
    }

    const prepared = [];

    for (const entry of entries) {
      const memberNumber = typeof entry.memberNumber === "string" ? entry.memberNumber.trim() : "";
      const programId = typeof entry.programId === "string" ? entry.programId.trim() : "";
      const monthFrom = typeof entry.monthFrom === "string" ? entry.monthFrom.trim() : "";
      const monthTo = typeof entry.monthTo === "string" ? entry.monthTo.trim() : "";
      const amountCollected = Number(entry.amountCollected);
      const nopFrom = Number(entry.nopFrom);
      const nopTo = Number(entry.nopTo);

      if (!memberNumber || !programId || !isMonth(monthFrom) || !isMonth(monthTo) || monthFrom > monthTo || !Number.isFinite(amountCollected) || amountCollected <= 0 || !Number.isInteger(nopFrom) || !Number.isInteger(nopTo) || nopFrom < 1 || nopTo < nopFrom || typeof entry.orNumber !== "string" || !entry.orNumber.trim() || typeof entry.orDate !== "string" || !entry.orDate.trim()) {
        return NextResponse.json({ success: false, message: "One or more collection entries are incomplete or invalid." }, { status: 400 });
      }

      if (nopTo - nopFrom + 1 !== countMonths(monthFrom, monthTo)) {
        return NextResponse.json({ success: false, message: "NOP range must match the number of covered months." }, { status: 400 });
      }

      const [member, enrollment] = await Promise.all([
        findMemberByNumber(memberNumber),
        findMemberProgramEnrollment(memberNumber, programId),
      ]);

      if (!member || !enrollment) {
        return NextResponse.json({ success: false, message: `Member ${memberNumber} is not enrolled in the selected program.` }, { status: 400 });
      }

      if (
        String(enrollment.branch).trim() !== branch ||
        String(enrollment.mas).trim() !== mas
      ) {
        return NextResponse.json({ success: false, message: `Collection for ${memberNumber} must use its assigned Branch and MAS.` }, { status: 400 });
      }

      prepared.push({ entry, member, enrollment, amountCollected, nopFrom, nopTo, monthFrom, monthTo, programId });
    }

    const timestamp = new Date().toISOString();
    const remittanceId = createId("REM");
    await addRemittance({ id: remittanceId, branch, mas, dateRemitted, createdAt: timestamp });
    await addCollections(prepared.map(({ entry, member, enrollment, amountCollected, nopFrom, nopTo, monthFrom, monthTo, programId }) => ({
      collectionId: createId("COL"), remittanceId, enrollmentId: String(enrollment.enrollmentId), memberId: String(member.memberId), memberNumber: String(member.memberNumber), programId, branch, mas,
      orNumber: entry.orNumber.trim(), orDate: entry.orDate.trim(), amountCollected, monthFrom, monthTo, nopFrom, nopTo,
      reactivation: entry.reactivation === "Yes" ? "Yes" : "No", transferred: entry.transferred === "Yes" ? "Yes" : "No", suspended: typeof entry.ifSuspended === "string" ? entry.ifSuspended.trim() : "", originalMas: typeof entry.originalMasOfficerName === "string" ? entry.originalMasOfficerName.trim() : "", status: "Posted", createdAt: timestamp,
    })));

    return NextResponse.json({ success: true, remittanceId, message: `${prepared.length} collection${prepared.length === 1 ? "" : "s"} saved successfully.` }, { status: 201 });
  } catch (error) {
    console.error("Save collections error:", error);
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to save collections." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { canAdjustLateness } from "@/lib/attendance-board";
import { canManageConfigurationFor } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { DEFAULT_RADIUS_M, isValidCoordinate, MAX_RADIUS_M, MIN_RADIUS_M } from "@/lib/clock-in-location";
import { withEncoder } from "@/lib/encoder-context";
import { setBranchLocation } from "@/lib/master-data-crud";

/**
 * Saves where a branch office is, for the clock-in location check: { branchId, latitude, longitude, radiusM }, or
 * { branchId, clear: true } to stop checking. IT, administrators and HR (who review the flagged clock-ins) may set it.
 */
export const PUT = withEncoder(async (request: Request) => {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ success: false, message: "Please sign in." }, { status: 401 });
  if (!canManageConfigurationFor(user) && !canAdjustLateness(user)) return NextResponse.json({ success: false, message: "You are not allowed to set branch locations." }, { status: 403 });
  try {
    const body = await request.json();
    const branchId = typeof body.branchId === "string" ? body.branchId.trim() : "";
    if (!branchId) throw new Error("Choose a branch.");
    if (body.clear === true) {
      await setBranchLocation(branchId, null, user.name);
      return NextResponse.json({ success: true, message: "Location removed. Clock-ins at this branch are no longer checked." });
    }
    const latitude = Number(body.latitude), longitude = Number(body.longitude);
    if (!isValidCoordinate(latitude, longitude)) throw new Error("Enter a valid location, e.g. 7.4475, 125.8078.");
    const radius = body.radiusM === undefined || body.radiusM === "" ? DEFAULT_RADIUS_M : Number(body.radiusM);
    if (!Number.isFinite(radius) || radius < MIN_RADIUS_M || radius > MAX_RADIUS_M) throw new Error(`The allowed distance must be from ${MIN_RADIUS_M} to ${MAX_RADIUS_M} meters.`);
    await setBranchLocation(branchId, { latitude, longitude, radiusM: Math.round(radius) }, user.name);
    return NextResponse.json({ success: true, message: "Location saved. Clock-ins at this branch are now checked." });
  } catch (error) {
    return NextResponse.json({ success: false, message: error instanceof Error ? error.message : "Unable to save the location." }, { status: 400 });
  }
});

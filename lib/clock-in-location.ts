/**
 * Clock-in location check (owner, October 24, 2026). Each branch can have its office location saved (latitude,
 * longitude and an allowed distance). A clock-in compares the phone's location with it:
 * - Inside: within the allowed distance (plus the phone's own uncertainty, up to 100 m).
 * - Outside: farther away. The clock-in is saved but flagged for HR.
 * - No location: the phone refused or could not give its location. Saved and flagged the same way.
 * - Not set: the branch has no saved location yet, so nothing is checked (clock-in works as before).
 * HR accepts a flagged clock-in (the day stays Present) or marks the day Absent.
 * This file has no runtime imports, so scripts/test-attendance-rules.mjs loads it directly.
 */

export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 2000;
/** The phone's reported uncertainty is forgiven up to this much, so weak GPS indoors does not flag someone at the office. */
export const MAX_ACCURACY_ALLOWANCE_M = 100;

export type ClockInResult = "Inside" | "Outside" | "No location" | "Not set";
export type ReviewStatus = "Accepted" | "Absent";
export type DevicePosition = { latitude: number; longitude: number; accuracy: number | null } | { error: string };
export type BranchLocation = { latitude: number | null; longitude: number | null; radiusM: number | null };

export const isValidCoordinate = (latitude: unknown, longitude: unknown) =>
  typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude)
  && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 && !(latitude === 0 && longitude === 0);

export const hasLocation = (branch: BranchLocation) => isValidCoordinate(branch.latitude, branch.longitude);

/** Straight-line distance in meters between two points (haversine). */
export function distanceMeters(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = radians(to.latitude - from.latitude);
  const dLng = radians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The allowed distance for a branch: its own, kept between 50 m and 2 km, else 150 m. */
export function radiusOf(branch: BranchLocation) {
  const radius = Number(branch.radiusM);
  return Number.isFinite(radius) && radius > 0 ? Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, Math.round(radius))) : DEFAULT_RADIUS_M;
}

export function checkClockIn(branch: BranchLocation, position: DevicePosition | null) {
  if (!hasLocation(branch)) return { result: "Not set" as ClockInResult, distanceM: null, radiusM: null };
  const radiusM = radiusOf(branch);
  if (!position || "error" in position || !isValidCoordinate(position.latitude, position.longitude)) return { result: "No location" as ClockInResult, distanceM: null, radiusM };
  const distanceM = Math.round(distanceMeters(position, { latitude: branch.latitude as number, longitude: branch.longitude as number }));
  const allowance = Math.min(MAX_ACCURACY_ALLOWANCE_M, Math.max(0, Number(position.accuracy) || 0));
  return { result: (distanceM <= radiusM + allowance ? "Inside" : "Outside") as ClockInResult, distanceM, radiusM };
}

/** Outside and No location wait for HR until accepted or marked Absent. */
export const needsReview = (result: string) => result === "Outside" || result === "No location";

export const formatDistance = (meters: number) => meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;

/** "Outside branch (2.3 km away)", "Location off", "Inside branch (40 m)", "Branch location not set". */
export function clockInLabel(check: { result: string; distanceM: number | null }) {
  if (check.result === "Outside") return `Outside branch${check.distanceM != null ? ` (${formatDistance(check.distanceM)} away)` : ""}`;
  if (check.result === "No location") return "Location off";
  if (check.result === "Inside") return `Inside branch${check.distanceM != null ? ` (${formatDistance(check.distanceM)})` : ""}`;
  return "Branch location not set";
}

/**
 * Coordinates typed or pasted, e.g. from Google Maps: "7.4475, 125.8078" or "7.4475 125.8078". Null when not valid.
 */
export function parseCoordinates(text: string) {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text ?? "");
  if (!match) return null;
  const latitude = Number(match[1]), longitude = Number(match[2]);
  return isValidCoordinate(latitude, longitude) ? { latitude, longitude } : null;
}

/**
 * Branch address from its saved location (owner, November 9, 2026): when a branch's office location is saved, its
 * Barangay, City / Municipality, Province, Country and Postal Code are looked up from OpenStreetMap's free address
 * lookup (Nominatim reverse geocoding). Only the coordinates are sent. Fields already typed are kept
 * (lib/master-data-crud.ts fillBranchAddress). A failed lookup never stops the location from saving.
 */

export type LookedUpAddress = { barangay: string; cityMunicipality: string; province: string; country: string; postalCode: string };

const clean = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const first = (address: Record<string, unknown>, keys: string[]) => keys.map((key) => clean(address[key])).find(Boolean) ?? "";

/** Reads Nominatim's reverse answer. In the Philippines a barangay is a village, suburb or quarter; "state" is the region. */
export function addressFromNominatim(body: unknown): LookedUpAddress | null {
  const address = body && typeof body === "object" ? (body as { address?: unknown }).address : null;
  if (!address || typeof address !== "object") return null;
  const parts = address as Record<string, unknown>;
  const city = first(parts, ["city", "town", "municipality"]);
  const found = {
    barangay: first(parts, ["village", "suburb", "quarter", "neighbourhood", "hamlet"]),
    cityMunicipality: city,
    province: first(parts, ["province", "county", "state_district", "state"]).replace(/^Province of /i, ""),
    country: first(parts, ["country"]),
    postalCode: first(parts, ["postcode"]),
  };
  // A barangay named like the city is the city itself, not a barangay.
  if (found.barangay && found.barangay === city) found.barangay = "";
  return Object.values(found).some(Boolean) ? found : null;
}

/** Looks up the address at a point; null when the service gives none or does not answer within 8 seconds. */
export async function lookUpAddress(latitude: number, longitude: number): Promise<LookedUpAddress | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "DayongSystem/1.0 (branch address lookup)", "Accept-Language": "en" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!response.ok) return null;
  return addressFromNominatim(await response.json());
}

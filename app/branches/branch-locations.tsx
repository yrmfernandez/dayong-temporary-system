"use client";

import { useState } from "react";
import { Crosshair, MapPin } from "lucide-react";

import { confirmDialog } from "@/components/app-dialog";
import { InlinePanel } from "@/components/inline-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_RADIUS_M, formatDistance, MAX_RADIUS_M, MIN_RADIUS_M, parseCoordinates } from "@/lib/clock-in-location";

export type LocatedBranch = {
  id: string; name: string; territory: string; status: "active" | "inactive";
  latitude: number | null; longitude: number | null; locationRadiusM: number | null; locationSetBy: string; locationSetAt: string;
};

export const locationIsSet = (branch: LocatedBranch) => branch.latitude != null && branch.longitude != null;
const mapLink = (latitude: number, longitude: number) => `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
const savedOn = (iso: string) => iso ? new Date(iso).toLocaleDateString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric" }) : "";

/**
 * Branch locations for the clock-in check (owner, October 24, 2026): every active branch, those without a location
 * first, so they can be set one by one. A branch without a location is not checked; clock-in works as before.
 */
export function BranchLocations({ branches, canSet, onSaved }: { branches: LocatedBranch[]; canSet: boolean; onSaved: () => Promise<void> | void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const active = branches.filter((branch) => branch.status === "active");
  const missing = active.filter((branch) => !locationIsSet(branch));
  const listed = (showAll ? active : missing).slice().sort((a, b) => Number(locationIsSet(a)) - Number(locationIsSet(b)) || a.name.localeCompare(b.name));

  return <Card>
    <CardHeader className="pb-2">
      <CardTitle className="flex flex-wrap items-center gap-2 text-base"><MapPin className="size-4 text-primary" />Branch locations for clock-in
        <Badge variant={missing.length ? "secondary" : "default"}>{active.length - missing.length} of {active.length} set</Badge>
      </CardTitle>
      <p className="text-sm text-muted-foreground">A clock-in more than the allowed distance from its branch, or with location turned off, is still saved but flagged for HR on the Daily board and in Attendance Review. Branches without a location are not checked. To set one, stand inside the office and press <strong>Use my current location</strong>, or paste the coordinates from Google Maps.</p>
    </CardHeader>
    <CardContent className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button type="button" size="sm" variant={showAll ? "outline" : "default"} onClick={() => setShowAll(false)}>Not set yet ({missing.length})</Button>
        <Button type="button" size="sm" variant={showAll ? "default" : "outline"} onClick={() => setShowAll(true)}>All active branches ({active.length})</Button>
      </div>
      {!listed.length ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">{showAll ? "No active branches." : "Every active branch has its location set."}</p>
        : <div className="divide-y rounded-lg border">{listed.map((branch) => <div key={branch.id} className="space-y-3 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="font-medium">{branch.name}</p><p className="text-xs text-muted-foreground">{branch.territory || "No territory"} · {branch.id}</p></div>
            <div className="flex flex-wrap items-center gap-2">
              {locationIsSet(branch)
                ? <><Badge>Set · {formatDistance(branch.locationRadiusM ?? DEFAULT_RADIUS_M)} allowed</Badge><a className="text-xs font-medium text-primary hover:underline" href={mapLink(branch.latitude as number, branch.longitude as number)} target="_blank" rel="noreferrer">View map</a></>
                : <Badge variant="outline" className="border-amber-400 text-amber-800">Location not set</Badge>}
              {canSet && <Button type="button" size="sm" variant={openId === branch.id ? "default" : "outline"} onClick={() => setOpenId(openId === branch.id ? null : branch.id)}>{openId === branch.id ? "Close" : locationIsSet(branch) ? "Change" : "Set location"}</Button>}
            </div>
          </div>
          {locationIsSet(branch) && branch.locationSetBy && <p className="text-xs text-muted-foreground">Saved by {branch.locationSetBy}{branch.locationSetAt ? ` on ${savedOn(branch.locationSetAt)}` : ""}.</p>}
          {openId === branch.id && <LocationEditor branch={branch} onDone={async () => { setOpenId(null); await onSaved(); }} />}
        </div>)}</div>}
    </CardContent>
  </Card>;
}

function LocationEditor({ branch, onDone }: { branch: LocatedBranch; onDone: () => Promise<void> }) {
  const [coordinates, setCoordinates] = useState(locationIsSet(branch) ? `${branch.latitude}, ${branch.longitude}` : "");
  const [radius, setRadius] = useState(String(branch.locationRadiusM ?? DEFAULT_RADIUS_M));
  const [locating, setLocating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const parsed = parseCoordinates(coordinates);

  function useCurrentLocation() {
    if (!navigator.geolocation) { setMessage("This device or browser cannot give its location."); return; }
    setLocating(true); setMessage("Getting your location...");
    navigator.geolocation.getCurrentPosition((position) => {
      setCoordinates(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`);
      const accuracy = Math.round(position.coords.accuracy);
      setMessage(accuracy > 100 ? `Location found, but only accurate to about ${accuracy} m. Move near a window or outside the door and try again, or check it on the map before saving.` : `Location found (accurate to about ${accuracy} m). Check it on the map, then save.`);
      setLocating(false);
    }, (error) => {
      setMessage(error.code === error.PERMISSION_DENIED ? "Location permission was refused. Allow location for this site in the browser settings and try again." : "Could not get your location. Try again, or paste the coordinates from Google Maps.");
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  async function save(clear = false) {
    if (clear && !await confirmDialog(`Remove the location of ${branch.name}? Clock-ins there will no longer be checked.`)) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/branches/location", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(clear ? { branchId: branch.id, clear: true } : { branchId: branch.id, latitude: parsed?.latitude, longitude: parsed?.longitude, radiusM: radius }) });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.message || "Unable to save the location.");
      await onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save the location."); }
    finally { setSaving(false); }
  }

  return <InlinePanel>
    <div className="space-y-3">
      <Button type="button" variant="outline" disabled={locating || saving} onClick={useCurrentLocation}><Crosshair className="mr-2 size-4" />{locating ? "Locating..." : "Use my current location"}</Button>
      <div className="grid gap-3 sm:grid-cols-[1fr_10rem]">
        <div className="space-y-1"><Label htmlFor={`coordinates-${branch.id}`}>Latitude, longitude</Label><Input id={`coordinates-${branch.id}`} inputMode="decimal" placeholder="e.g. 7.447500, 125.807800" value={coordinates} onChange={(event) => setCoordinates(event.target.value)} />
          <p className="text-xs text-muted-foreground">In Google Maps, press and hold (or right-click) the office and copy the numbers shown.</p></div>
        <div className="space-y-1"><Label htmlFor={`radius-${branch.id}`}>Allowed distance (m)</Label><Input id={`radius-${branch.id}`} type="number" min={MIN_RADIUS_M} max={MAX_RADIUS_M} step={10} value={radius} onChange={(event) => setRadius(event.target.value)} />
          <p className="text-xs text-muted-foreground">{DEFAULT_RADIUS_M} m suits most offices; widen it where GPS is weak.</p></div>
      </div>
      {coordinates && !parsed && <p className="text-xs text-red-700">Enter the latitude and longitude separated by a comma.</p>}
      {message && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={saving || locating || !parsed} onClick={() => void save()}>{saving ? "Saving..." : "Save location"}</Button>
        {parsed && <a className="text-sm font-medium text-primary hover:underline" href={mapLink(parsed.latitude, parsed.longitude)} target="_blank" rel="noreferrer">Check on the map</a>}
        {locationIsSet(branch) && <Button type="button" variant="ghost" className="text-destructive" disabled={saving} onClick={() => void save(true)}>Remove location</Button>}
      </div>
    </div>
  </InlinePanel>;
}

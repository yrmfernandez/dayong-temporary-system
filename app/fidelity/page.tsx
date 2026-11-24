import { redirect } from "next/navigation";

import { canMonitorFidelity } from "@/lib/access-control";
import { getSessionUser } from "@/lib/auth-server";
import { FidelityMonitoring } from "./fidelity-views";

// Company-wide monitoring; everyone else only has their own savings, at /fidelity/me. The same rule as the API
// (lib/access-control.ts canMonitorFidelity): before November 24, 2026 this page sent Entry Clerks, who had a Fidelity
// item in their menu, and Finance-Auditor to My Fidelity.
export default async function FidelityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!canMonitorFidelity(user)) redirect("/fidelity/me");
  return <FidelityMonitoring />;
}

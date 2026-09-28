import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth-server";
import { FidelityMonitoring } from "./fidelity-views";

const monitoringRoles = ["administrator", "admin", "finance", "ceo", "president"];

// Company-wide monitoring; everyone else only has their own savings, at /fidelity/me.
export default async function FidelityPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!user.roleNames.some((role) => monitoringRoles.includes(role.trim().toLowerCase()))) redirect("/fidelity/me");
  return <FidelityMonitoring />;
}

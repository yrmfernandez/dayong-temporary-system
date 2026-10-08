import nextEnv from "@next/env";
nextEnv.loadEnvConfig(process.cwd());
const { getExecutiveAnalytics } = await import("./lib/executive-analytics");
const { getRemittanceDashboard } = await import("./lib/remittance-workflow");
const { getCommissions, getVendorPayables } = await import("./lib/finance-operations");
const { getEmployees } = await import("./lib/employees");
const parts: Record<string, () => Promise<unknown>> = { analytics: () => getExecutiveAnalytics("mtd", { financeOnly: true }), remittance: () => getRemittanceDashboard(), payables: () => getVendorPayables(), commissions: () => getCommissions(), employees: () => getEmployees() };
for (let i = 1; i <= 15; i++) {
  const pending = new Set(Object.keys(parts));
  const start = performance.now();
  const all = Promise.all(Object.entries(parts).map(([name, run]) => run().then(() => pending.delete(name))));
  const result = await Promise.race([all.then(() => "ok"), new Promise((resolve) => setTimeout(() => resolve("HUNG"), 30000))]);
  console.log(`run ${i}: ${result} in ${Math.round(performance.now() - start)} ms${result === "HUNG" ? ` · still waiting on: ${[...pending].join(", ")}` : ""}`);
  if (result === "HUNG") break;
}
process.exit(0);

import { timingSafeEqual } from "node:crypto";

import { getSessionUser } from "@/lib/auth-server";
import { canManageConfigurationFor } from "@/lib/access-control";
import { runNightlyJobs } from "@/lib/nightly-jobs";

// The status sync reads every account; give it room beyond the default limit.
export const maxDuration = 60;

const matches = (given: string, expected: string) => {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Vercel Cron (vercel.json) calls this once a night with "Authorization: Bearer <CRON_SECRET>". It is the only caller
 * allowed without a session (proxy.ts); without CRON_SECRET set on the server it refuses, so nobody else can run it.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim() ?? "";
  if (!secret) return Response.json({ success: false, message: "CRON_SECRET is not set on the server." }, { status: 503 });
  if (!matches(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return Response.json({ success: false, message: "Not allowed." }, { status: 401 });
  const run = await runNightlyJobs("Scheduled");
  return Response.json({ success: run.ok, run }, { status: run.ok ? 200 : 500 });
}

/** IT runs the nightly jobs now from System Health. */
export async function POST() {
  const user = await getSessionUser();
  if (!user || !canManageConfigurationFor(user)) return Response.json({ success: false, message: "Only IT and administrators can run the nightly jobs." }, { status: 403 });
  const run = await runNightlyJobs(`Run now by ${user.name}`);
  return Response.json({ success: true, message: run.ok ? "Nightly jobs finished." : "Nightly jobs finished with a problem; see the steps.", run });
}

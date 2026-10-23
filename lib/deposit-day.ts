import { asAuditPeriod, periodSpan } from "@/lib/daily-audit";

/**
 * A deposit belongs to the report it is entered on (owner, October 23, 2026: "if they want to really go to that date,
 * they just change the period of their report"): its date must be in that report's period (the day of a daily report).
 * A clerk who recorded a deposit on the wrong day entered it again on another report instead (CABALLERO, JENNY,
 * October 19 and 20). The real transfer date, when different, goes in the remarks.
 */
export function depositDayProblem(body: Record<string, unknown>) {
  const kind = asAuditPeriod(String(body.reportKind ?? "")), reportDate = String(body.reportDate ?? "");
  if (!kind || !/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) return "";
  const { start, end } = periodSpan(kind, reportDate), date = String(body.date ?? "");
  if (date >= start && date <= end) return "";
  return start === end
    ? `A deposit belongs to the report it is entered on: this report is for ${start}. To record it on ${date || "another day"}, open the report for that day. Put the real transfer date in the remarks if it differs.`
    : `A deposit belongs to the report it is entered on: choose a date from ${start} to ${end}, or open the report for ${date || "that day"}.`;
}

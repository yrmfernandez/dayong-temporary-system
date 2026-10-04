import { redirect } from "next/navigation";

/** Old address of the weekly report; it is now a tab on Reports. */
export default function WeeklyReportPage() {
  redirect("/reports?tab=weekly");
}

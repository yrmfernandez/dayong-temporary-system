import { redirect } from "next/navigation";

/** Old address of the monthly report; it is now a tab on Reports. */
export default function MonthlyReportPage() {
  redirect("/reports?tab=monthly");
}

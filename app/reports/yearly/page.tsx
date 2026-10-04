import { redirect } from "next/navigation";

/** Old address of the yearly report; it is now a tab on Reports. */
export default function YearlyReportPage() {
  redirect("/reports?tab=yearly");
}

import { redirect } from "next/navigation";

/** Old address of the daily report; it is now a tab on Reports. */
export default function DailyReportPage() {
  redirect("/reports?tab=daily");
}

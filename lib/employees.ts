import { sheets, GOOGLE_SHEET_ID } from "@/lib/google-sheets";
import { appendEncodedRows } from "@/lib/encoder-sheets";

export async function getEmployees() {
  const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "'Employees'!A:I" });
  return (response.data.values ?? []).slice(1).filter((r) => r[0]).map((r) => ({
    id: String(r[0]), name: String(r[1] ?? ""), branch: String(r[2] ?? ""), roles: String(r[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    status: String(r[4] ?? ""), contact: String(r[5] ?? ""), email: String(r[6] ?? ""), dateHired: String(r[7] ?? ""), createdAt: String(r[8] ?? ""),
  }));
}

export async function registerEmployee(body: Record<string, unknown>) {
  const text = (key: string) => typeof body[key] === "string" ? (body[key] as string).trim() : "";
  const name = text("name"), branch = text("branch"), role = text("role"), contact = text("contact"), email = text("email"), dateHired = text("dateHired");
  if (!name || name.length > 150) throw new Error("Enter a full name of up to 150 characters.");
  if (!branch || branch.length > 150) throw new Error("Enter a branch.");
  if (!["MAS", "Collector", "Entry Clerk", "IT Clerk", "Admin", "HR", "CEO"].includes(role)) throw new Error("Select a valid operational role.");
  if (contact.length > 50 || email.length > 254 || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) throw new Error("Check the contact number and email.");
  if (dateHired && (!/^\d{4}-\d{2}-\d{2}$/.test(dateHired) || !Number.isFinite(Date.parse(dateHired)) || new Date(dateHired).toISOString().slice(0, 10) !== dateHired)) throw new Error("Enter a valid date hired.");
  const [employees, users] = await Promise.all([getEmployees(), sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Users!A:B" })]);
  const ids = [...employees.map((e) => e.id), ...(users.data.values ?? []).slice(1).map((r) => String(r[1] ?? ""))];
  const next = ids.reduce((max, id) => /^DPE-\d{4}$/.test(id) ? Math.max(max, Number(id.slice(4))) : max, 0) + 1;
  if (next > 9999) throw new Error("Employee ID capacity reached.");
  const id = `DPE-${String(next).padStart(4, "0")}`;
  await appendEncodedRows({ range: "Employees!A:I", requestBody: { values: [[id, name, branch, role, "active", contact, email, dateHired, new Date().toISOString()].map((v) => `'${v}`)] } });
  return { id };
}

import { canManageUsers, getSessionUser } from "@/lib/auth-server";
import { withEncoder } from "@/lib/encoder-context";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { recordCorrection } from "@/lib/record-corrections";

const sources = [
  { module: "New Sales", range: "'Sales'!A:AU", user: 45, at: 46, detail: (r: unknown[]) => `${r[5] ?? ""} Â· ${r[40] ?? ""}`, editable: (r: unknown[]) => ({ applicationNumber: String(r[40] ?? ""), amountPaid: Number(r[38] ?? 0), notes: String(r[39] ?? "") }) },
  { module: "Collections", range: "'Collections'!A:AG", user: 23, at: 24, detail: (r: unknown[]) => `${r[4] ?? ""} Â· OR ${r[8] ?? ""}`, editable: (r: unknown[]) => ({ orNumber: String(r[8] ?? ""), orDate: String(r[9] ?? ""), amountCollected: Number(r[10] ?? 0), remittanceStatus: String(r[28] ?? "") }) },
  { module: "Remittances", range: "'Remittances'!A:X", user: 8, at: 9, detail: (r: unknown[]) => `${r[2] ?? ""} Â· ${r[4] ?? ""}` },
  { module: "Expenses", range: "'Expenses'!A:U", user: 19, at: 20, detail: (r: unknown[]) => `${r[2] ?? ""} Â· ${r[3] ?? ""}` },
  { module: "Cash Transactions", range: "'Cash Transactions'!A:T", user: 18, at: 19, detail: (r: unknown[]) => `${r[2] ?? ""} Â· ${r[3] ?? ""}` },
  { module: "Cash Accounts", range: "'Cash Accounts'!A:I", user: 7, at: 8, detail: (r: unknown[]) => `${r[1] ?? ""} · ${r[2] ?? ""}` },
  { module: "Vendor Payables", range: "'Vendor Payables'!A:S", user: 17, at: 18, detail: (r: unknown[]) => `${r[3] ?? ""} · ${r[5] ?? ""}` },
  { module: "Commissions", range: "'Commissions'!A:P", user: 14, at: 15, detail: (r: unknown[]) => `${r[2] ?? ""} · ${r[3] ?? ""} to ${r[4] ?? ""}` },
  { module: "Members", range: "'Members'!A:AH", user: 32, at: 33, detail: (r: unknown[]) => `${r[1] ?? ""} Â· ${r[3] ?? ""} ${r[2] ?? ""}` },
  { module: "Member Programs", range: "'Member programs'!A:S", user: 16, at: 17, detail: (r: unknown[]) => `${r[2] ?? ""} Â· ${r[3] ?? ""}` },
  { module: "Employees", range: "'Employees'!A:M", user: 11, at: 12, detail: (r: unknown[]) => String(r[1] ?? "") },
  { module: "Branches", range: "'Branches'!A:Q", user: 15, at: 16, detail: (r: unknown[]) => `${r[1] ?? ""} Â· ${r[2] ?? ""}` },
  { module: "Programs", range: "'Programs'!A:M", user: 8, at: 9, detail: (r: unknown[]) => `${r[1] ?? ""} Â· ${r[2] ?? ""}` },
];
export async function GET() {
  const user = await getSessionUser();
  const finance = user?.roleNames.some((role) => role.trim().toLowerCase() === "finance");
  if (!(await canManageUsers()) && !finance) return Response.json({ success: false, message: "Administrator or Finance access is required." }, { status: 403 });
  try {
    const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: sources.map((source) => source.range), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" });
    const entries = sources.flatMap((source,index)=>(response.data.valueRanges?.[index]?.values??[]).slice(1).filter(row=>String(row[0]??"").trim()).map(row=>({ id:String(row[0]), module:source.module, detail:source.detail(row), encodedBy:String(row[source.user]??"").replace(/^'/,""), encodedAt:String(row[source.at]??""), data: "editable" in source ? source.editable!(row) : null }))).filter(entry=>entry.encodedAt||entry.encodedBy).sort((a,b)=>b.encodedAt.localeCompare(a.encodedAt)).slice(0,1000);
    return Response.json({ success:true, entries, canCorrect: await canManageUsers() },{headers:{"Cache-Control":"private, no-store"}});
  } catch(error){ return Response.json({success:false,message:error instanceof Error?error.message:"Unable to load history."},{status:500}); }
}
export const PATCH = withEncoder(async (request: Request) => {
  if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 });
  try {
    const body = await request.json(); const id = String(body.id ?? "").trim(), module = String(body.module ?? ""), reason = String(body.reason ?? "").trim();
    if (!id || !reason) throw new Error("Record and correction reason are required.");
    const isSale = module === "New Sales", sheet = isSale ? "Sales" : module === "Collections" ? "Collections" : "";
    if (!sheet) throw new Error("Only New Sales and Collections can be corrected here.");
    const response = await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `'${sheet}'!A:AU`, valueRenderOption: "UNFORMATTED_VALUE" });
    const rows = response.data.values ?? [], index = rows.slice(1).findIndex((row) => String(row[0] ?? "").trim() === id);
    if (index < 0) throw new Error("Record not found."); const rowNumber = index + 2, row = rows[index + 1];
    if (!isSale && !["", "Outstanding"].includes(String(row[28] ?? ""))) throw new Error("A Collection linked to a Remittance must be corrected through reconciliation, not direct editing.");
    const before = isSale ? { applicationNumber: row[40], amountPaid: row[38], notes: row[39] } : { orNumber: row[8], orDate: row[9], amountCollected: row[10] };
    const amount = Number(isSale ? body.amountPaid : body.amountCollected); if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid amount greater than zero.");
    const after = isSale ? { applicationNumber: String(body.applicationNumber ?? "").trim(), amountPaid: amount, notes: String(body.notes ?? "").trim() } : { orNumber: String(body.orNumber ?? "").trim(), orDate: String(body.orDate ?? "").trim(), amountCollected: amount };
    if (isSale && !after.applicationNumber) throw new Error("Application number is required.");
    if (!isSale && (!after.orNumber || !/^\d{4}-\d{2}-\d{2}$/.test(after.orDate))) throw new Error("Valid OR number and OR date are required.");
    const data = isSale ? [{ range: `'Sales'!AM${rowNumber}:AO${rowNumber}`, values: [[after.amountPaid, after.notes, after.applicationNumber]] }] : [{ range: `'Collections'!I${rowNumber}:K${rowNumber}`, values: [[after.orNumber, after.orDate, after.amountCollected]] }];
    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: GOOGLE_SHEET_ID, requestBody: { valueInputOption: "USER_ENTERED", data } });
    await recordCorrection(module, id, reason, before, after);
    return Response.json({ success: true, message: `${module} record corrected and audited.` });
  } catch (error) { return Response.json({ success: false, message: error instanceof Error ? error.message : "Unable to correct record." }, { status: 400 }); }
});



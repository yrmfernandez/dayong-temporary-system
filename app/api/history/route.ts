import { canManageUsers } from "@/lib/auth-server";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";

const sources = [
  { module: "New Sales", range: "'Sales'!A:AU", user: 45, at: 46, detail: (r: unknown[]) => `${r[5] ?? ""} · ${r[40] ?? ""}` },
  { module: "Collections", range: "'Collections'!A:AG", user: 23, at: 24, detail: (r: unknown[]) => `${r[4] ?? ""} · OR ${r[8] ?? ""}` },
  { module: "Remittances", range: "'Remittances'!A:X", user: 8, at: 9, detail: (r: unknown[]) => `${r[2] ?? ""} · ${r[4] ?? ""}` },
  { module: "Expenses", range: "'Expenses'!A:U", user: 19, at: 20, detail: (r: unknown[]) => `${r[2] ?? ""} · ${r[3] ?? ""}` },
  { module: "Cash Transactions", range: "'Cash Transactions'!A:T", user: 18, at: 19, detail: (r: unknown[]) => `${r[2] ?? ""} · ${r[3] ?? ""}` },
  { module: "Members", range: "'Members'!A:AH", user: 32, at: 33, detail: (r: unknown[]) => `${r[1] ?? ""} · ${r[3] ?? ""} ${r[2] ?? ""}` },
  { module: "Member Programs", range: "'Member programs'!A:S", user: 16, at: 17, detail: (r: unknown[]) => `${r[2] ?? ""} · ${r[3] ?? ""}` },
  { module: "Employees", range: "'Employees'!A:M", user: 11, at: 12, detail: (r: unknown[]) => String(r[1] ?? "") },
  { module: "Branches", range: "'Branches'!A:Q", user: 15, at: 16, detail: (r: unknown[]) => `${r[1] ?? ""} · ${r[2] ?? ""}` },
  { module: "Programs", range: "'Programs'!A:J", user: 8, at: 9, detail: (r: unknown[]) => `${r[1] ?? ""} · ${r[2] ?? ""}` },
];
export async function GET() { if (!(await canManageUsers())) return Response.json({ success: false, message: "Administrator access is required." }, { status: 403 }); try { const response = await sheets.spreadsheets.values.batchGet({ spreadsheetId: GOOGLE_SHEET_ID, ranges: sources.map((source) => source.range), valueRenderOption: "UNFORMATTED_VALUE", dateTimeRenderOption: "FORMATTED_STRING" }); const entries = sources.flatMap((source,index)=>(response.data.valueRanges?.[index]?.values??[]).slice(1).filter(row=>String(row[0]??"").trim()).map(row=>({ id:String(row[0]), module:source.module, detail:source.detail(row), encodedBy:String(row[source.user]??"").replace(/^'/,""), encodedAt:String(row[source.at]??"") }))).filter(entry=>entry.encodedAt||entry.encodedBy).sort((a,b)=>b.encodedAt.localeCompare(a.encodedAt)).slice(0,1000); return Response.json({ success:true, entries },{headers:{"Cache-Control":"private, no-store"}}); } catch(error){ return Response.json({success:false,message:error instanceof Error?error.message:"Unable to load history."},{status:500}); } }

import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getEmployees } from "@/lib/employees";
import { createReadableId } from "@/lib/readable-id";
import { sql } from "drizzle-orm";
import { currentDb, encodedBy, getDb, inTransaction, schema } from "@/lib/db";
import { createCashTransaction } from "@/lib/finance-data";
import { cashOutDetails } from "@/lib/finance-operations";
import { FIDELITY_CAP, baseWithdrawalAmount, fidelityStanding } from "@/lib/fidelity-cap";
const text=(value:unknown)=>String(value??"").trim();
const amount=(value:unknown)=>Math.round((Number(value)||0)*100)/100;
const peso=(value:number)=>value.toLocaleString("en-PH",{style:"currency",currency:"PHP"});
/**
 * Fidelity is the employee's own money, handed to the Entry Clerk with a batch and added to that remittance.
 * Contributions have no limit and nothing is locked (owner, October 30, 2026): the first FIDELITY_CAP (the base) is
 * withdrawn by a percentage or a fixed amount, the excess above it on its own, or the whole balance at once.
 */
export { FIDELITY_CAP } from "@/lib/fidelity-cap";
export const WITHDRAWAL_TYPES={base:"Base Withdrawal",excess:"Excess Withdrawal",full:"Full Withdrawal"} as const;
// The earlier full release, allowed only once the employee had left (before October 30, 2026); still money paid out.
const SEPARATION_TYPE="Separation Release";
/**
 * Balances brought from the old system's Fidelity Bond sheet (owner, October 23, 2026; scripts/import-fidelity-opening-20261023.mts):
 * the 2022-2026 total as an approved opening balance, and what an active employee already withdrew there as paid out.
 */
export const OPENING_TYPE="Opening Balance (old system)",OLD_WITHDRAWAL_TYPE="Withdrawal (old system)";
// "Claim" rows are the earlier release-at-the-cap records; they still count as money paid out.
const PAID_OUT=new Set(["claim",SEPARATION_TYPE.toLowerCase(),OLD_WITHDRAWAL_TYPE.toLowerCase(),...Object.values(WITHDRAWAL_TYPES).map(type=>type.toLowerCase())]);
async function source(){const response=await sheets.spreadsheets.values.batchGet({spreadsheetId:GOOGLE_SHEET_ID,ranges:["'Remittances'!A:Y","'Fidelity'!A:O"],valueRenderOption:"UNFORMATTED_VALUE",dateTimeRenderOption:"FORMATTED_STRING"});const remittances=response.data.valueRanges?.[0]?.values??[],claims=response.data.valueRanges?.[1]?.values??[];return{remittances,claims}}
/**
 * Who encoded each slip's Fidelity (owner, October 16, 2026): slips are created by "System", so the history shows the
 * person who encoded the entries on the slip (any linked entry; a returned slip keeps its links), else who received a
 * Fidelity handed in after encoding (Remittances R), else the slip's encoder.
 */
async function encodersOf(slipIds:string[]){
 if(!slipIds.length)return new Map<string,string>();
 const result=await getDb().execute(sql`select rc.remittance_id as id, min(coalesce(nullif(c.encoded_by_name,''), nullif(s.encoded_by_name,''))) as name
   from remittance_collections rc left join collections c on c.collection_id = rc.collection_id left join sales s on s.sale_id = rc.collection_id
   where rc.remittance_id in (${sql.join(slipIds.map(id=>sql`${id}`),sql`, `)}) group by rc.remittance_id`);
 const rows=(Array.isArray(result)?result:(result as {rows?:unknown[]}).rows??[]) as Array<{id:string;name:string|null}>;
 return new Map(rows.filter(row=>text(row.name)).map(row=>[row.id,text(row.name)]));
}
/** A rejected slip went back to the clerk to fix: shown as Returned, as on the entries (owner, October 16, 2026). */
const shownStatus=(status:string)=>status==="Rejected"?"Returned":status;
export async function getFidelityData(employeeId:string,viewAll:boolean){
 const {remittances,claims}=await source();
 const slips=remittances.slice(1).filter(row=>text(row[0])&&text(row[13])&&amount(row[24])>0);
 const encoders=await encodersOf(slips.map(row=>text(row[0])));
 const contributions=slips.map(row=>{
  const slipEncoder=/^system$/i.test(text(row[8]))?"":text(row[8]);
  return{id:text(row[0]),masEmployeeId:text(row[13]),masName:text(row[2]),date:text(row[3]),status:shownStatus(text(row[4])),amount:amount(row[24]),type:"Contribution",direction:"in" as const,encodedBy:encoders.get(text(row[0]))||text(row[17])||slipEncoder,remarks:text(row[22]),branch:text(row[1])};
 });
 const withdrawals=claims.slice(1).filter(row=>text(row[0])&&PAID_OUT.has(text(row[5]).toLowerCase())).map(row=>({id:text(row[0]),masEmployeeId:text(row[1]),masName:text(row[2]),date:text(row[8]),status:text(row[9])||"Released",amount:amount(row[7]),type:text(row[5]),direction:"out" as const,encodedBy:text(row[13]),remarks:text(row[10]),branch:""}));
 const openings=claims.slice(1).filter(row=>text(row[0])&&text(row[5]).toLowerCase()===OPENING_TYPE.toLowerCase()).map(row=>({id:text(row[0]),masEmployeeId:text(row[1]),masName:text(row[2]),date:text(row[8]),status:"Approved",amount:amount(row[7]),type:OPENING_TYPE,direction:"in" as const,encodedBy:text(row[13]),remarks:text(row[10]),branch:""}));
 const transactions=[...contributions,...openings,...withdrawals].filter(item=>viewAll||item.masEmployeeId===employeeId).sort((a,b)=>b.date.localeCompare(a.date));
 const employees=await getEmployees();
 // Every active employee can sell as a MAS (see the MAS lists in New Sales and Collections), so each may save Fidelity.
 const ids=[...new Set([...employees.filter(item=>item.status.toLowerCase()==="active").map(item=>item.id),...transactions.map(item=>item.masEmployeeId)])].filter(id=>viewAll||id===employeeId);
 const accounts=ids.map(id=>{
  const own=transactions.filter(item=>item.masEmployeeId===id),employee=employees.find(item=>item.id===id);
  const contributed=amount(own.filter(item=>item.direction==="in"&&item.status==="Approved").reduce((sum,item)=>sum+item.amount,0));
  const claimed=amount(own.filter(item=>item.direction==="out").reduce((sum,item)=>sum+item.amount,0));
  const approved=Math.max(0,amount(contributed-claimed));
  const pending=amount(own.filter(item=>item.type==="Contribution"&&["Pending Approval","Discrepancy"].includes(item.status)).reduce((sum,item)=>sum+item.amount,0));
  // An employee who is no longer active (resigned, inactive) has left the company: shown so Finance pays out the rest.
  const separated=Boolean(employee)&&employee!.status.toLowerCase()!=="active";
  const standing=fidelityStanding(approved);
  // Branch and roles for the Fidelity Monitoring filters (owner, October 16, 2026).
  return{masEmployeeId:id,masName:own[0]?.masName||employee?.name||id,employmentStatus:employee?.status||"",branch:employee?.branch||"",roles:employee?.roles??[],approved,pending,claimed,total:approved,
   base:standing.base,excess:standing.excess,remaining:standing.remaining,separated};
 }).sort((a,b)=>a.masName.localeCompare(b.masName));
 return{cap:FIDELITY_CAP,accounts,transactions};
}
/**
 * Records money paid out of an employee's Fidelity, at any time (owner, October 30, 2026).
 * - "base": from the first FIDELITY_CAP, as a percentage of the base held (`mode: "percent"`) or a fixed amount.
 * - "excess": any amount up to the balance above FIDELITY_CAP.
 * - "full": the whole balance.
 */
export async function withdrawFidelity(masEmployeeId:string,kind:string,requested:number,notes:string,cashInput:{account?:unknown;branch?:unknown;date?:unknown}={},mode=""){
 const data=await getFidelityData("",true),account=data.accounts.find(item=>item.masEmployeeId===text(masEmployeeId));
 if(!account)throw new Error("Fidelity account was not found.");
 let paid:number,type:string,detail="";
 if(kind==="full"){
  if(account.approved<=0)throw new Error("There is no Fidelity balance to withdraw.");
  paid=account.approved;type=WITHDRAWAL_TYPES.full;
 }else if(kind==="base"){
  if(account.base<=0)throw new Error("There is no Fidelity base to withdraw.");
  const value=amount(requested),result=baseWithdrawalAmount(account.base,mode,value);
  if(result===null)throw new Error(mode==="percent"?"Enter a percentage from 0.01 to 100.":`Enter an amount from ₱0.01 to ${peso(account.base)}.`);
  paid=result;type=WITHDRAWAL_TYPES.base;
  // The percentage is kept with the payout so the history shows how it was worked out.
  if(mode==="percent")detail=`${value}% of ${peso(account.base)}`;
 }else if(kind==="excess"){
  paid=amount(requested);
  if(!(paid>0))throw new Error("Enter the amount to withdraw.");
  if(paid>account.excess)throw new Error(account.excess>0?`At most ${peso(account.excess)} can be withdrawn as excess: the balance above ${peso(FIDELITY_CAP)}.`:`${account.masName} has no balance above ${peso(FIDELITY_CAP)}.`);
  type=WITHDRAWAL_TYPES.excess;
 }else throw new Error("Choose a base, excess or full withdrawal.");
 notes=[detail,text(notes)].filter(Boolean).join(" · ");
 // The payout also leaves the cash ledger, where the Fidelity came in with its remittance (upgrade #3, October 24, 2026).
 const cash=await cashOutDetails(cashInput,account.branch);
 const id=createReadableId("FCL");
 await inTransaction(async()=>{
  await currentDb().insert(schema.fidelity).values({fidelity_id:id,mas_employee_id:account.masEmployeeId,mas_name:account.masName,transaction_type:type,incentive_amount:0,fidelity_amount:paid,transaction_date:cash.date,status:"Released",notes:text(notes)||null,...encodedBy()});
  await createCashTransaction({date:cash.date,direction:"outflow",category:"Fidelity release",description:`${type}: ${account.masName}`,amount:paid,branch:cash.branch,account:cash.account,referenceType:"Fidelity",referenceId:id,remarks:text(notes)});
 });
 return{amount:paid,type,masName:account.masName};
}

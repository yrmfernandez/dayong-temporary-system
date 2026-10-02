import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getEmployees } from "@/lib/employees";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { createReadableId } from "@/lib/readable-id";
const text=(value:unknown)=>String(value??"").trim();
const amount=(value:unknown)=>Math.round((Number(value)||0)*100)/100;
const peso=(value:number)=>value.toLocaleString("en-PH",{style:"currency",currency:"PHP"});
/**
 * Fidelity is the employee's own money, handed to the Entry Clerk with a batch and added to that remittance.
 * Contributions have no limit. The first FIDELITY_CAP of the balance is locked until the employee leaves the company;
 * anything above it may be withdrawn at any time.
 */
export const FIDELITY_CAP=10000;
export const WITHDRAWAL_TYPES={excess:"Excess Withdrawal",separation:"Separation Release"} as const;
// "Claim" rows are the earlier release-at-the-cap records; they still count as money paid out.
const PAID_OUT=new Set(["claim",...Object.values(WITHDRAWAL_TYPES).map(type=>type.toLowerCase())]);
async function source(){const response=await sheets.spreadsheets.values.batchGet({spreadsheetId:GOOGLE_SHEET_ID,ranges:["'Remittances'!A:Y","'Fidelity'!A:O"],valueRenderOption:"UNFORMATTED_VALUE",dateTimeRenderOption:"FORMATTED_STRING"});const remittances=response.data.valueRanges?.[0]?.values??[],claims=response.data.valueRanges?.[1]?.values??[];return{remittances,claims}}
export async function getFidelityData(employeeId:string,viewAll:boolean){
 const {remittances,claims}=await source();
 const contributions=remittances.slice(1).filter(row=>text(row[0])&&text(row[13])&&amount(row[24])>0).map(row=>({id:text(row[0]),masEmployeeId:text(row[13]),masName:text(row[2]),date:text(row[3]),status:text(row[4]),amount:amount(row[24]),type:"Contribution",encodedBy:text(row[8]),remarks:text(row[22])}));
 const withdrawals=claims.slice(1).filter(row=>text(row[0])&&PAID_OUT.has(text(row[5]).toLowerCase())).map(row=>({id:text(row[0]),masEmployeeId:text(row[1]),masName:text(row[2]),date:text(row[8]),status:text(row[9])||"Released",amount:amount(row[7]),type:text(row[5]),encodedBy:text(row[13]),remarks:text(row[10])}));
 const transactions=[...contributions,...withdrawals].filter(item=>viewAll||item.masEmployeeId===employeeId).sort((a,b)=>b.date.localeCompare(a.date));
 const employees=await getEmployees();
 // Every active employee can sell as a MAS (see the MAS lists in New Sales and Collections), so each may save Fidelity.
 const ids=[...new Set([...employees.filter(item=>item.status.toLowerCase()==="active").map(item=>item.id),...transactions.map(item=>item.masEmployeeId)])].filter(id=>viewAll||id===employeeId);
 const accounts=ids.map(id=>{
  const own=transactions.filter(item=>item.masEmployeeId===id),employee=employees.find(item=>item.id===id);
  const contributed=amount(own.filter(item=>item.type==="Contribution"&&item.status==="Approved").reduce((sum,item)=>sum+item.amount,0));
  const claimed=amount(own.filter(item=>item.type!=="Contribution").reduce((sum,item)=>sum+item.amount,0));
  const approved=Math.max(0,amount(contributed-claimed));
  const pending=amount(own.filter(item=>item.type==="Contribution"&&["Pending Approval","Discrepancy"].includes(item.status)).reduce((sum,item)=>sum+item.amount,0));
  // An employee who is no longer active (resigned, inactive) has left the company and may take the whole balance.
  const separated=Boolean(employee)&&employee!.status.toLowerCase()!=="active";
  const withdrawable=amount(Math.max(0,approved-FIDELITY_CAP));
  return{masEmployeeId:id,masName:own[0]?.masName||employee?.name||id,employmentStatus:employee?.status||"",approved,pending,claimed,total:approved,
   locked:amount(Math.min(approved,FIDELITY_CAP)),withdrawable,remaining:Math.max(0,amount(FIDELITY_CAP-approved)),separated,readyForRelease:separated&&approved>0};
 }).sort((a,b)=>a.masName.localeCompare(b.masName));
 return{cap:FIDELITY_CAP,accounts,transactions};
}
/**
 * Records money paid out of an employee's Fidelity.
 * - "excess": any amount up to the balance above FIDELITY_CAP, at any time.
 * - "separation": the whole balance, only once the employee is no longer active.
 */
export async function withdrawFidelity(masEmployeeId:string,kind:string,requested:number,notes:string){
 const data=await getFidelityData("",true),account=data.accounts.find(item=>item.masEmployeeId===text(masEmployeeId));
 if(!account)throw new Error("Fidelity account was not found.");
 let paid:number,type:string;
 if(kind==="separation"){
  if(!account.separated)throw new Error(`${account.masName} is still an active employee. The first ${peso(FIDELITY_CAP)} is released only when they leave the company; only the amount above it can be withdrawn.`);
  if(account.approved<=0)throw new Error("There is no Fidelity balance to release.");
  paid=account.approved;type=WITHDRAWAL_TYPES.separation;
 }else if(kind==="excess"){
  paid=amount(requested);
  if(!(paid>0))throw new Error("Enter the amount to withdraw.");
  if(paid>account.withdrawable)throw new Error(account.withdrawable>0?`At most ${peso(account.withdrawable)} can be withdrawn: the balance above ${peso(FIDELITY_CAP)}.`:`Nothing can be withdrawn yet: only the balance above ${peso(FIDELITY_CAP)} is withdrawable while ${account.masName} is employed.`);
  type=WITHDRAWAL_TYPES.excess;
 }else throw new Error("Choose an excess withdrawal or a separation release.");
 const date=new Date().toISOString().slice(0,10);
 await appendEncodedRows({range:"'Fidelity'!A:K",requestBody:{values:[[createReadableId("FCL"),account.masEmployeeId,account.masName,"","",type,0,paid,date,"Released",text(notes)]]}});
 return{amount:paid,type,masName:account.masName};
}

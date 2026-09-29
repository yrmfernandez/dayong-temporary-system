import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { getEmployees } from "@/lib/employees";
import { appendEncodedRows } from "@/lib/encoder-sheets";
import { createReadableId } from "@/lib/readable-id";
const text=(value:unknown)=>String(value??"").trim();
const amount=(value:unknown)=>Math.round((Number(value)||0)*100)/100;
export const FIDELITY_CAP=10000;
async function source(){const response=await sheets.spreadsheets.values.batchGet({spreadsheetId:GOOGLE_SHEET_ID,ranges:["'Remittances'!A:Y","'Fidelity'!A:O"],valueRenderOption:"UNFORMATTED_VALUE",dateTimeRenderOption:"FORMATTED_STRING"});const remittances=response.data.valueRanges?.[0]?.values??[],claims=response.data.valueRanges?.[1]?.values??[];return{remittances,claims}}
export async function getFidelityData(employeeId:string,viewAll:boolean){
 const {remittances,claims}=await source();
 const contributions=remittances.slice(1).filter(row=>text(row[0])&&text(row[14]).toLowerCase()==="mas"&&amount(row[24])>0).map(row=>({id:text(row[0]),masEmployeeId:text(row[13]),masName:text(row[2]),date:text(row[3]),status:text(row[4]),amount:amount(row[24]),type:"Contribution",encodedBy:text(row[8]),remarks:text(row[22])}));
 const claimTransactions=claims.slice(1).filter(row=>text(row[0])&&text(row[5]).toLowerCase()==="claim").map(row=>({id:text(row[0]),masEmployeeId:text(row[1]),masName:text(row[2]),date:text(row[8]),status:text(row[9])||"Claimed",amount:amount(row[7]),type:"Claim",encodedBy:text(row[13]),remarks:text(row[10])}));
 const transactions=[...contributions,...claimTransactions].filter(item=>viewAll||item.masEmployeeId===employeeId).sort((a,b)=>b.date.localeCompare(a.date));
 const employees=await getEmployees();
 // Every active employee can sell as a MAS (see the MAS lists in New Sales and Collections), so each may save Fidelity.
 const ids=[...new Set([...employees.filter(item=>item.status.toLowerCase()==="active").map(item=>item.id),...transactions.map(item=>item.masEmployeeId)])].filter(id=>viewAll||id===employeeId);
 const accounts=ids.map(id=>{const own=transactions.filter(item=>item.masEmployeeId===id),approvedContributions=amount(own.filter(item=>item.type==="Contribution"&&item.status==="Approved").reduce((sum,item)=>sum+item.amount,0)),claimed=amount(own.filter(item=>item.type==="Claim").reduce((sum,item)=>sum+item.amount,0)),approved=Math.max(0,amount(approvedContributions-claimed)),pending=amount(own.filter(item=>item.type==="Contribution"&&["Pending Approval","Discrepancy"].includes(item.status)).reduce((sum,item)=>sum+item.amount,0));return{masEmployeeId:id,masName:own[0]?.masName||employees.find(item=>item.id===id)?.name||id,approved,pending,claimed,total:approved,remaining:Math.max(0,amount(FIDELITY_CAP-approved)),readyForRelease:approved>=FIDELITY_CAP}}).sort((a,b)=>a.masName.localeCompare(b.masName));
 return{cap:FIDELITY_CAP,accounts,transactions};
}
export async function claimFidelity(masEmployeeId:string,notes:string){const data=await getFidelityData("",true),account=data.accounts.find(item=>item.masEmployeeId===text(masEmployeeId));if(!account)throw new Error("MAS Fidelity account was not found.");if(!account.readyForRelease)throw new Error("Fidelity can only be claimed after the current balance reaches ₱10,000.");await appendEncodedRows({range:"'Fidelity'!A:K",requestBody:{values:[[createReadableId("FCL"),account.masEmployeeId,account.masName,"","","Claim",0,FIDELITY_CAP,new Date().toISOString().slice(0,10),"Claimed",text(notes)||"Fidelity claimed; current balance reset to zero."]]}});return{amount:FIDELITY_CAP}}

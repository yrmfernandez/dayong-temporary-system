import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply=process.argv.includes("--apply"),spreadsheetId=process.env.GOOGLE_SHEET_ID;
if(!spreadsheetId)throw new Error("Missing GOOGLE_SHEET_ID.");
const auth=new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n")},scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const sheets=google.sheets({version:"v4",auth});
const response=await sheets.spreadsheets.values.get({spreadsheetId,range:"Programs!1:1"});
const headers=response.data.values?.[0]??[];
const metadata=await sheets.spreadsheets.get({spreadsheetId,fields:"sheets.properties.title"});
const existing=new Set(metadata.data.sheets?.map(sheet=>sheet.properties?.title));
const support=[
 {title:"Record Corrections",headers:["correction_id","module","record_id","reason","before_json","after_json","corrected_at","encoded_by_user_id","encoded_by_employee_id","encoded_by_username","encoded_at"]},
 {title:"Report Remarks",headers:["remark_id","date_from","date_to","report_type","scope","comment","created_at","encoded_by_user_id","encoded_by_employee_id","encoded_by_username","encoded_at"]},
 {title:"Fidelity",headers:["fidelity_id","mas_employee_id","mas_name","collection_id","remittance_id","transaction_type","incentive_amount","fidelity_amount","transaction_date","status","notes","encoded_by_user_id","encoded_by_employee_id","encoded_by_username","encoded_at"]},
];
const missing=support.filter(item=>!existing.has(item.title));
console.log(`Programs currently has ${headers.length} header cells. ${missing.length} audit/report support sheet(s) need creation.`);
if(!apply)console.log("Dry run passed. Run npm run sheets:program-rules -- --apply.");
else{
 if(missing.length)await sheets.spreadsheets.batchUpdate({spreadsheetId,requestBody:{requests:missing.map(item=>({addSheet:{properties:{title:item.title}}}))}});
 const changes=[{range:"Programs!K1:M1",values:[["registration_fee_required","registration_amount","pay_balance_total"]]},{range:"Sales!AN1",values:[["notes"]]},{range:"Collections!B1",values:[["collection_batch_id"]]},{range:"Remittances!Y1",values:[["fidelity_amount"]]},...support.map(item=>({range:`'${item.title}'!A1:${item.title==="Fidelity"?"O":"K"}1`,values:[item.headers]}))];
 await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:"RAW",data:changes}});console.log("Program rules, audit sheets, and report remark headers are ready.");
}


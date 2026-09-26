import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply=process.argv.includes("--apply"),spreadsheetId=process.env.GOOGLE_SHEET_ID;
const auth=new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n")},scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const sheets=google.sheets({version:"v4",auth});
const text=v=>String(v??"").trim();
if(!spreadsheetId)throw new Error("Missing GOOGLE_SHEET_ID.");
const response=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges:["Roles!A:K","'User Roles'!A:B"]});
const rows=response.data.valueRanges?.[0]?.values??[],links=response.data.valueRanges?.[1]?.values??[],seen=new Set(),updates=[];
for(let index=1;index<rows.length;index++){const row=rows[index];if(!text(row[1]))continue;let id=text(row[0]);if(!id||seen.has(id)){const old=id;id=`ROLE-${crypto.randomUUID()}`;updates.push({range:`Roles!A${index+1}`,values:[[id]]});console.log(`Row ${index+1} ${text(row[1])}: duplicate/missing ${old||"ID"} -> ${id}. Existing assignments remain with the first ${old||"role"}.`);}seen.add(id);}
if(!rows.slice(1).some(row=>text(row[1]).toLowerCase()==="finance")){updates.push({range:`Roles!A${rows.length+1}:G${rows.length+1}`,values:[[ `ROLE-${crypto.randomUUID()}`,"Finance","Financial control and reconciliation",false,false,false,"active"]]});console.log("Finance role will be added.");}
const dangling=links.slice(1).filter(row=>text(row[1])&&!seen.has(text(row[1])));if(dangling.length)console.log(`${dangling.length} User Roles assignment(s) reference an unknown role ID and require review.`);
if(!updates.length)console.log("Roles already have unique IDs and Finance exists.");else if(!apply)console.log(`${updates.length} change(s) ready. Run npm run sheets:roles -- --apply.`);else{await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:"RAW",data:updates}});console.log(`Applied ${updates.length} role change(s).`);}

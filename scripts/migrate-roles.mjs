import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply=process.argv.includes("--apply"),spreadsheetId=process.env.GOOGLE_SHEET_ID;
const auth=new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n")},scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const sheets=google.sheets({version:"v4",auth});
const text=v=>String(v??"").trim();
const slug=value=>text(value).toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"")||"CUSTOM";
if(!spreadsheetId)throw new Error("Missing GOOGLE_SHEET_ID.");
const response=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges:["Roles!A:K","'User Roles'!A:F"]});
const rows=response.data.valueRanges?.[0]?.values??[],links=response.data.valueRanges?.[1]?.values??[];
const used=new Set(),mapping=new Map(),roleUpdates=[];
for(let index=1;index<rows.length;index++){
  const row=rows[index],name=text(row[1]); if(!name)continue;
  const old=text(row[0]); let id=`ROLE-${slug(name)}`,suffix=2;
  while(used.has(id)) id=`ROLE-${slug(name)}-${String(suffix++).padStart(2,"0")}`;
  used.add(id); if(old) mapping.set(old,id);
  if(old!==id){roleUpdates.push({range:`Roles!A${index+1}`,values:[[id]]});console.log(`${name}: ${old||"(missing)"} -> ${id}`);}
}
if(!rows.slice(1).some(row=>text(row[1]).toLowerCase()==="finance")){
  let row=rows.length+1; roleUpdates.push({range:`Roles!A${row}:G${row}`,values:[["ROLE-FINANCE","Finance","Financial control and reconciliation",false,false,false,"active"]]}); used.add("ROLE-FINANCE"); console.log("Finance role will be added as ROLE-FINANCE.");
}
const linkUpdates=[];
for(let index=1;index<links.length;index++){const old=text(links[index][1]),next=mapping.get(old);if(next&&next!==old)linkUpdates.push({range:`'User Roles'!B${index+1}`,values:[[next]]});}
const updates=[...roleUpdates,...linkUpdates];
if(!updates.length)console.log("Role IDs are already uniform and unique.");
else if(!apply)console.log(`${roleUpdates.length} role and ${linkUpdates.length} assignment update(s) ready. Run npm run sheets:roles -- --apply.`);
else{await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:"RAW",data:updates}});console.log(`Applied ${updates.length} linked update(s).`);}

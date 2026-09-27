import nextEnv from "@next/env";
import { google } from "googleapis";
nextEnv.loadEnvConfig(process.cwd());
const apply=process.argv.includes("--apply"),spreadsheetId=process.env.GOOGLE_SHEET_ID;
if(!spreadsheetId)throw new Error("Missing GOOGLE_SHEET_ID.");
const auth=new google.auth.GoogleAuth({credentials:{client_email:process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,private_key:process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n")},scopes:["https://www.googleapis.com/auth/spreadsheets"]});
const sheets=google.sheets({version:"v4",auth}),text=v=>String(v??"").trim();
const tables=[
 {sheet:"Employee Branches",range:"A:F",prefix:"EBA"},{sheet:"Member programs",range:"A:R",prefix:"ENR"},{sheet:"Sales",range:"A:AU",prefix:"SAL"},
 {sheet:"Remittances",range:"A:AB",prefix:"REM"},{sheet:"Remittance Collections",range:"A:I",prefix:"RCL"},{sheet:"Collections",range:"A:AG",prefix:"COL"},
 {sheet:"Program Incentives",range:"A:L",prefix:"INC"},{sheet:"Attendance",range:"A:Y",prefix:"ATT"},{sheet:"Leave Requests",range:"A:O",prefix:"LR"},
 {sheet:"Expenses",range:"A:U",prefix:"EXP"},{sheet:"Cash Transactions",range:"A:T",prefix:"CASH"},
];
const quote=s=>`'${s.replaceAll("'","''")}'`;
const response=await sheets.spreadsheets.values.batchGet({spreadsheetId,ranges:tables.map(t=>`${quote(t.sheet)}!${t.range}`)});
const all=new Map(tables.map((table,index)=>[table.sheet,response.data.valueRanges?.[index]?.values??[]]));
const maps=new Map(),updates=[];
for(const table of tables){const rows=all.get(table.sheet),map=new Map();let counter=1;for(let i=1;i<rows.length;i++){const old=text(rows[i][0]);if(!old)continue;const next=`${table.prefix}-${String(counter++).padStart(6,"0")}`;map.set(old,next);if(old!==next)updates.push({range:`${quote(table.sheet)}!A${i+1}`,values:[[next]]});}maps.set(table.sheet,map);console.log(`${table.sheet}: ${map.size} IDs, ${[...map].filter(([a,b])=>a!==b).length} rename(s)`);}
function rel(sheet,column,target,when=()=>true){const rows=all.get(sheet),map=maps.get(target);for(let i=1;i<rows.length;i++){if(!when(rows[i]))continue;const old=text(rows[i][column]),next=map.get(old);if(next&&next!==old){let n=column+1,name="";while(n){name=String.fromCharCode(65+(n-1)%26)+name;n=Math.floor((n-1)/26);}updates.push({range:`${quote(sheet)}!${name}${i+1}`,values:[[next]]});}}}
rel("Member programs",0,"Member programs");
rel("Collections",2,"Member programs"); rel("Collections",29,"Remittances"); rel("Collections",0,"Collections");
rel("Program Incentives",0,"Program Incentives");
rel("Remittance Collections",1,"Remittances"); rel("Remittance Collections",2,"Collections");
rel("Cash Transactions",9,"Remittances",row=>text(row[8]).toLowerCase()==="remittance");
rel("Cash Transactions",9,"Expenses",row=>text(row[8]).toLowerCase()==="expense");
// Remove duplicate primary-key updates accidentally introduced by the generic relation calls.
const unique=[...new Map(updates.map(item=>[item.range,item])).values()];
console.log(`${unique.length} primary/foreign-key cell update(s) prepared.`);
if(!apply)console.log("Dry run complete. Use npm run sheets:ids -- --apply after reviewing counts.");
else{for(let i=0;i<unique.length;i+=400){await sheets.spreadsheets.values.batchUpdate({spreadsheetId,requestBody:{valueInputOption:"RAW",data:unique.slice(i,i+400)}});}console.log("Human-readable ID migration applied with linked references.");}


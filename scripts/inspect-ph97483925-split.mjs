// Inspect the owner-selected member's source identity and New Sales without printing personal fields.
import nextEnv from '@next/env';
import postgres from 'postgres';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {loadLegacySources} from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
const key=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const words=v=>String(v??'').toUpperCase().replace(/[^A-Z ]/g,' ').split(/\s+/).filter(v=>v&&!['JR','SR'].includes(v)).sort().join(' ');
try{
 const [m]=await sql`select * from members where member_number='PH-97483925'`;
 if(!m)throw Error('Member missing.');
 console.log(JSON.stringify({member:m.member_number,id:m.member_id,currentSuffix:m.name_extension,hasBirthdate:Boolean(m.birthdate),hasContact:Boolean(m.member_contact),hasAddress:Boolean(m.address)}));
 const base=words([m.surname,m.first_name,m.middle_name].join(' '));
 const selected=[];
 const files=['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx'];
 if(process.argv.includes('--2025'))files.push('legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx');
 for(const file of files)for(const source of await loadLegacySources([file]))for(const tab of source.tabs){
  const [header,...rows]=tab.rows;
  const col=header.findIndex(v=>key(v)==='PHMEMBER');
  if(col<0)continue;
  for(const [i,row] of rows.entries()){
   if(words(row[col])!==base)continue;
   const cell=k=>row[header.findIndex(v=>key(v)===key(k))];
   const sourceRow=tab.firstRow+i+1;
   const ref=`Data-Base-Old|${tab.title}|${sourceRow}`;
   const saleId='SALE-LEG-'+createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase();
   const suffix=/\bJR\b/i.test(String(row[col]))?'JR':/\bSR\b/i.test(String(row[col]))?'SR':'';
   const metadata=Object.fromEntries(header.map((h,j)=>[String(h),row[j]]).filter(([h])=>/^(BRANCH|DAYONG PROGRAM|OR NUMBER|OR DATE|NOP|MONTH OF|AMOUNT COLLECTED|APPLICATION NO\.?|DATE REMITTED)$/i.test(h)));
   console.log(JSON.stringify({file,tab:tab.title,sourceRow,suffix,existingSale:saleId==='SALE-LEG-3C06924F7B',metadata}));
   selected.push({file,tab:tab.title,sourceRow,ref,suffix,header,row});
  }
 }
 writeFileSync('legacy-data/ph97483925-source-split.json',JSON.stringify({memberId:m.member_id,selected},null,2));
}finally{await sql.end();}

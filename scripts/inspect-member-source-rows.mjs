// Read-only match by deterministic source collection IDs, including receipts whose labels were corrected.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {loadLegacySources} from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member=process.argv[2];if(!/^PH-\d{8}$/.test(member??''))throw Error('Pass PH member number.');
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
let payments;
try{payments=await sql`select collection_id,or_number,or_date::text,amount_collected::float8,nop_from,nop_to,month_from,month_to from collections where member_number=${member} order by or_date,collection_id`;}finally{await sql.end();}
const ids=new Map(payments.map(p=>[p.collection_id,p]));
const sources=await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
const matches=[];
for(const source of sources)for(const tab of source.tabs.filter(t=>t.title.endsWith('COLL'))){
 const [headers,...rows]=tab.rows;
 for(const [i,row]of rows.entries()){
  const ref=`Data-Base-Old|${tab.title}|${tab.firstRow+i+1}`;
  const id=`COL-LEG-${createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase()}`;
  if(ids.has(id))matches.push({id,ref,current:ids.get(id),source:Object.fromEntries(headers.map((h,j)=>[String(h),row[j]]).filter(([h])=>/PH\/MEMBER|OR NUMBER|OR DATE|MONTH OF|NOP|DAYONG PROGRAM|AMOUNT COLLECTED|DOI|BRANCH/.test(h)))});
 }
}
fs.writeFileSync(`legacy-data/${member}-source-rows.json`,JSON.stringify(matches,null,2));
console.log(JSON.stringify({member,matched:matches.length,total:payments.length,rows:matches},null,2));

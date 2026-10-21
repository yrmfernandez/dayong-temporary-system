// Read-only source and production ownership investigation.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const sql=postgres(process.env.DIRECT_DATABASE_URL,{max:1,onnotice:()=>{}});
try {
 const hits=await sql`select c.collection_id,c.member_id,c.member_number,c.enrollment_id,c.program_id,c.or_number,c.or_date::text,c.amount_collected::float8,c.nop_from,c.nop_to,c.month_from,c.month_to,c.status,c.linked_remittance_id,c.legacy_duplicate,m.surname,m.first_name,m.name_extension from collections c join members m on m.member_id=c.member_id where c.or_number ilike '%12617%'`;
 console.log(JSON.stringify({hits},null,2));
 const accounts=await sql`select mp.*,p.program_code,p.base_pay::float8 from member_programs mp join programs p on p.program_id=mp.program_id where mp.member_number='PH-68134668'`;
 const payments=await sql`select collection_id,enrollment_id,or_number,or_date::text,program_id,amount_collected::float8,nop_from,nop_to,month_from,month_to from collections where member_number='PH-68134668' order by or_date,collection_id`;
 console.log(JSON.stringify({accounts,payments},null,2));
 if(process.argv.includes('--legacy')) {
  const sources=await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
  const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const rows=[];
  for(const source of sources)for(const tab of source.tabs){
   const [header,...data]=tab.rows;const orCol=header.findIndex(h=>norm(h)==='ORNUMBER');if(orCol<0)continue;
   for(const [i,row]of data.entries())if(norm(row[orCol]).startsWith('12617'))rows.push({source:tab.title,row:tab.firstRow+i+1,fields:Object.fromEntries(header.map((h,j)=>[String(h),row[j]]).filter(([h])=>/MEMBER|PROGRAM|OR NUMBER|OR DATE|MONTH|NOP|AMOUNT|DOI|BRANCH|REMITTED/i.test(h)))});
  }
  fs.writeFileSync('legacy-data/or12617b-source-20261020.json',JSON.stringify(rows,null,2));
  console.log(JSON.stringify({sourceRows:rows},null,2));
 }
}finally{await sql.end();}

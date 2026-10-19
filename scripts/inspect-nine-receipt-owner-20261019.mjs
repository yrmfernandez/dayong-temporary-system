// Read-only source identity check for the owner's nine requested receipts.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { loadLegacySources } from './legacy-sources.mjs';
nextEnv.loadEnvConfig(process.cwd());
const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
const norm = v => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g,'');
const wanted = new Set(['10576C','11622C','14345C','4402B','15527C','17558C','20216C','22654C','24509C']);
const paired = new Set(['10575C','11623C','14346C','4401B','15528C','17559C','20217C','22653C','24510C']);
const hits = [];
for (const source of sources) for (const tab of source.tabs.filter(t => t.title === 'M3-COLL')) {
  const [header,...rows] = tab.rows;
  const col = key => header.findIndex(h => norm(h) === key);
  for (const [i,row] of rows.entries()) {
    const or = norm(row[col('ORNUMBER')]);
    if (!wanted.has(or) && !paired.has(or)) continue;
    const ref = `Data-Base-Old|${tab.title}|${tab.firstRow+i+1}`;
    hits.push({sourceRef:ref,collectionId:`COL-LEG-${createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase()}`,requested:wanted.has(or),receipt:row[col('ORNUMBER')],name:String(row[col('PHMEMBER')] ?? ''),program:row[col('DAYONGPROGRAM')],month:row[col('MONTHOF')],nop:row[col('NOP')],branch:row[col('BRANCH')],mas:row[col('MARKETINGAGENT')]});
  }
}
console.log(JSON.stringify({sourceRows:hits},null,2));
fs.writeFileSync('legacy-data/nine-receipt-source-review-20261019.json',JSON.stringify(hits,null,2));
const db = postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
try {
  console.log(JSON.stringify({currentPeople:await db`select member_id,member_number,first_name,middle_name,surname,name_extension from members where member_number in ('PH-89863784','PH-28847095')`},null,2));
} finally {await db.end();}

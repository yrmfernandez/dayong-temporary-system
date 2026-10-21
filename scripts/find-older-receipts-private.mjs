// Match the requested receipt numbers in the older workbook; store rows privately, print counts only.
import fs from 'node:fs';
import {loadLegacySources} from './legacy-sources.mjs';
import {receiptKey,sourceDay,programKey} from './source-history-rules.mjs';
const keys=process.argv.slice(2).map(v=>receiptKey(v).replace(/^0+(?=\d)/,''));
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function main(){
 const hits=[];
 for(const source of await loadLegacySources(['legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx']))for(const tab of source.tabs){
  const [headers,...rows]=tab.rows,positions=new Map(headers.map((h,i)=>[norm(h),i]));
  rows.forEach((row,i)=>{
   const get=k=>row[positions.get(k)],key=receiptKey(get('ORNUMBER')).replace(/^0+(?=\d)/,'');
   if(!keys.includes(key))return;
   hits.push({key,ref:`Data-Base-2025|${tab.title}|${tab.firstRow+i+1}`,headers,row,date:sourceDay(get('ORDATE')),program:programKey(get('DAYONGPROGRAM'))});
  });
 }
 fs.writeFileSync('legacy-data/older-requested-receipts-private.json',JSON.stringify(hits));
 console.log(JSON.stringify({receiptKeys:keys.length,sourceMatches:hits.length,matchesPerRequestedReceipt:keys.map(key=>hits.filter(r=>r.key===key).length),privateRowsSaved:true}));
}
main().catch(e=>{fs.writeFileSync('backups/older-receipts-error-private.json',JSON.stringify({message:e.message}));console.error('Older-source scan stopped; private diagnostic saved.');process.exitCode=1;});

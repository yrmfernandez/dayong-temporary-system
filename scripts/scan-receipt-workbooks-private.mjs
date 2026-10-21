// Search original workbook cells, including rows omitted from normalized receipt indexes.
// Matching rows stay private; output contains counts only.
import fs from 'node:fs';
import {loadLegacySources} from './legacy-sources.mjs';
import {receiptKey} from './source-history-rules.mjs';
const key=receiptKey(process.argv[2]??'').replace(/^0+(?=\d)/,'');
if(!/^\d+[A-Z]+$/.test(key))throw new Error('Pass receipt number and suffix.');
const digits=key.match(/^\d+/)[0];
const norm=v=>receiptKey(v).replace(/^0+(?=\d)/,'');
const hits=[];
let workbooks=0;
for(const source of await loadLegacySources(process.argv.includes('--exports')?['legacy-data/export','legacy-data']:['legacy-data/old-data'])){
 workbooks++;
 for(const tab of source.tabs){
  const [headers,...rows]=tab.rows;
  const orColumn=headers.findIndex(h=>String(h??'').toUpperCase().replace(/[^A-Z0-9]/g,'')==='ORNUMBER');
  rows.forEach((row,i)=>{
   const cells=row.flatMap((v,j)=>String(v??'').includes(digits)?[j]:[]);
   if(!cells.length)return;
   hits.push({source:source.id,tab:tab.title,rowNumber:tab.firstRow+i+1,headers,row,cells,
    exactReceipt:orColumn>=0&&norm(row[orColumn])===key,
    receiptDigits:orColumn>=0&&norm(row[orColumn]).replace(/[^0-9]/g,'')===digits});
  });
 }
}
fs.writeFileSync(`legacy-data/receipt-${key}-${process.argv.includes('--exports')?'export':'workbook'}-scan-private.json`,JSON.stringify(hits));
console.log(JSON.stringify({workbooks,matchingRows:hits.length,exactReceipts:hits.filter(h=>h.exactReceipt).length,receiptNumberMatches:hits.filter(h=>h.receiptDigits).length,privateReportSaved:true}));

// Extract original source cells into ignored files; report parser diagnostics only.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {loadLegacySources} from './legacy-sources.mjs';
import {sourceCoverage} from './source-history-rules.mjs';
import {crossYearMonths} from './source-cross-year-months.mjs';
const member=process.argv[2];
if(!/^PH-\d{8}$/.test(member??''))throw new Error('Pass member number.');
const norm=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function main(){
 const review=JSON.parse(fs.readFileSync(`legacy-data/member-review-${member}-private.json`,'utf8'));
 const wanted=new Set(review.history.map(r=>r.collection_id)),rows=[];
 if(process.argv.includes('--cached'))rows.push(...JSON.parse(fs.readFileSync(`legacy-data/member-source-${member}-private.json`,'utf8')));
 for(const source of rows.length?[]:await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']))for(const tab of source.tabs.filter(t=>/COLL$/i.test(t.title))){
  const [headers,...data]=tab.rows,positions=new Map(headers.map((h,i)=>[norm(h),i]));
  data.forEach((row,i)=>{
   const ref=`Data-Base-Old|${tab.title}|${tab.firstRow+i+1}`,id=`COL-LEG-${createHash('sha1').update(ref).digest('hex').slice(0,10).toUpperCase()}`;
   if(!wanted.has(id))return;
   const get=k=>row[positions.get(k)],monthText=get('MONTHOF'),nopText=get('NOP'),months=crossYearMonths(monthText);
   const nopNumbers=String(nopText??'').match(/\d+/g)?.map(Number)??[];
   rows.push({id,ref,headers,row,monthText,nopText,months,nopNumbers,coverage:sourceCoverage(monthText,nopText)});
  });
 }
 fs.writeFileSync(`legacy-data/member-source-${member}-private.json`,JSON.stringify(rows));
 console.log(JSON.stringify({receipts:wanted.size,sourceMatches:rows.length,parsedCoverage:rows.filter(r=>r.coverage).length,
  diagnostics:rows.filter(r=>!r.coverage).map(r=>({monthsParsed:Boolean(r.months),parsedMonthCount:r.months?.length??0,nopNumberCount:r.nopNumbers.length,nopCellIsDate:r.nopText instanceof Date||/^\d{4}-\d\d-\d\dT/.test(String(r.nopText)),monthCellIsDate:r.monthText instanceof Date,
   monthWordsRecognized:(String(r.monthText??'').match(/[A-Za-z]+/g)??[]).filter(w=>['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].includes(w.slice(0,3).toUpperCase())).length,
   explicitRangeFormat:/^\s*[A-Za-z]+(?:\s+20\d{2})?\s*(?:-|–|to)\s*[A-Za-z]+(?:\s+20\d{2})?\s*$/i.test(String(r.monthText??'')),
   nopNumbersContinuous:r.nopNumbers.every((n,i)=>!i||n===r.nopNumbers[i-1]+1),explicitMonthRange:/(?:-|–|\bto\b)/i.test(String(r.monthText)),nopSpanMatchesMonths:r.nopNumbers.length>0&&r.months?.length===Math.max(...r.nopNumbers)-Math.min(...r.nopNumbers)+1})),privateSourceSaved:true}));
}
main().catch(e=>{fs.writeFileSync('backups/member-source-error-private.json',JSON.stringify({message:e.message}));console.error('Source inspection stopped; diagnostic saved privately.');process.exitCode=1;});

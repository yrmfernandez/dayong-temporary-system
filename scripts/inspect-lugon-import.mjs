// Inspect owner-selected people in the newly supplied 2025 workbook. No personal fields printed.
import {loadLegacySources} from './legacy-sources.mjs';
import {writeFileSync} from 'node:fs';
const file='legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx';
const sources=await loadLegacySources([file]);
const key=v=>String(v??'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const selected=[];
for(const source of sources)for(const tab of source.tabs){
 const [header,...rows]=tab.rows;
 const member=header.findIndex(v=>key(v)==='PHMEMBER');
 console.log(JSON.stringify({tab:tab.title,rows:rows.length,memberColumn:member+1,headers:member<0?header:undefined}));
 if(member<0)continue;
 for(const [i,row] of rows.entries()){
  const name=String(row[member]??'').toUpperCase();
  if(!/\bLUGON\b/.test(name))continue;
  const wanted=/\bARMAN\b/.test(name)?'Arman':/\bJULIET\b/.test(name)?'Juliet':'Other Lugon';
  const ref=`${source.title}|${tab.title}|${tab.firstRow+i+1}`;
  const metadata=Object.fromEntries(header.map((h,j)=>[String(h),row[j]]).filter(([h])=>/OR NUMBER|OR DATE|AMOUNT|MONTH OF|NOP|DAYONG PROGRAM|BRANCH|MARKETING AGENT|DATE REMITTED|TIMESTAMP/i.test(h)));
  console.log(JSON.stringify({person:wanted,ref,metadata}));
  if(wanted!=='Other Lugon')selected.push({person:wanted,ref,tab:tab.title,sourceRow:tab.firstRow+i+1,header,row});
 }
}
writeFileSync('legacy-data/lugon-selected-20261017.json',JSON.stringify({file,selected},null,2));
console.log(JSON.stringify({selectedRows:selected.length,byPerson:Object.fromEntries(['Arman','Juliet'].map(p=>[p,selected.filter(r=>r.person===p).length]))}));

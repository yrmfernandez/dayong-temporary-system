// Rollback-only finance review; raw prices and records stay private.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {repriceEntries} from '../lib/entry-finance.mjs';
nextEnv.loadEnvConfig(process.cwd());
const member=process.argv[2];
if(!/^PH-\d{8}$/.test(member??''))throw new Error('Pass member number.');
const db=postgres(process.env.DIRECT_DATABASE_URL,{max:1,connect_timeout:15,onnotice:()=>{}});
class Rollback extends Error{}
async function main(){
 await db.begin(async tx=>{
  await tx`set transaction isolation level repeatable read`;
  const collections=await tx`select * from collections where member_number=${member} and status='Posted' order by collection_id for update`;
  const sales=await tx`select * from sales where member_number=${member} order by sale_id for update`;
  const finance=await repriceEntries((query,params)=>tx.unsafe(query,params),{collectionIds:collections.map(r=>r.collection_id),saleIds:sales.map(r=>r.sale_id)});
  fs.writeFileSync(`legacy-data/member-finance-${member}-private.json`,JSON.stringify({member,collections,sales,finance}));
  console.log(JSON.stringify({collectionsChecked:collections.length,newSalesChecked:sales.length,financialSnapshotsNeedingCorrection:finance.changes.length,remittanceExpectationsAffected:finance.slips.length,previewOnly:true}));
  throw new Rollback();
 });
}
main().catch(e=>{if(e instanceof Rollback){console.log('Finance review rolled back; no writes committed.');return;}
 fs.writeFileSync('backups/member-finance-error-private.json',JSON.stringify({message:e.message,code:e.code}));console.error('Finance review stopped; diagnostic saved privately.');process.exitCode=1;
}).finally(async()=>{await db.end();});

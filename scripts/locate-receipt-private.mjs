// Aggregate-only locator: keep candidate rows, histories and source references private.
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import {receiptKey} from './source-history-rules.mjs';
nextEnv.loadEnvConfig(process.cwd());
const key = String(process.argv[2] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (!/^\d+[A-Z]+$/.test(key)) throw new Error('Pass a receipt number and suffix.');
const canonical = (v) => receiptKey(v).replace(/^0+(?=\d)/, '');
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
async function main() {
  const collections = (await db`select * from collections where regexp_replace(or_key, '^0+', '') like ${canonical(key)+'%'}`).filter(r=>canonical(r.or_number)===canonical(key));
  const sales = await db`select * from sales where regexp_replace(regexp_replace(upper(coalesce(or_number,'')), '[^A-Z0-9]', '', 'g'), '^0+', '') = ${canonical(key)}`;
  const index = JSON.parse(fs.readFileSync('legacy-data/other-program-source-index-20261021.json', 'utf8'));
  const sourceCollections = Object.entries(index.collections).filter(([, s]) => canonical(s.or) === canonical(key)).map(([id,s]) => ({id,...s}));
  const sourceSales = Object.entries(index.sales).filter(([, s]) => canonical(s.or) === canonical(key)).map(([id,s]) => ({id,...s}));
  const audits = await db`select * from audit_log where action = 'delete' and table_name in ('collections','sales')
    and regexp_replace(regexp_replace(upper(coalesce(changes_json->>'or_number','')), '[^A-Z0-9]', '', 'g'), '^0+', '') = ${canonical(key)}`;
  fs.writeFileSync(`legacy-data/receipt-${key}-location-private.json`, JSON.stringify({key,collections,sales,sourceCollections,sourceSales,audits},null,2));
  console.log(JSON.stringify({ existingCollections: collections.length, existingSales: sales.length, sourceCollections: sourceCollections.length, sourceSales: sourceSales.length, deletedHistoryMatches: audits.length, privateReportSaved: true }));
}
main().catch((e) => { fs.writeFileSync('backups/receipt-location-error-private.json', JSON.stringify({message:e.message,code:e.code})); console.error('Locator stopped; diagnostic saved privately.'); process.exitCode=1; }).finally(async()=>{await db.end();});

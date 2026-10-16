/** Scoped financial backfill. Dry run performs all writes in a rolled-back transaction. No member personal data is read. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
import { repriceEntries } from '../lib/entry-finance.mjs';

nextEnv.loadEnvConfig(process.cwd());
const file = process.argv.find(arg => arg.startsWith('--config='))?.slice(9);
if (!file) throw new Error('Supply --config=config/<reviewed-scope>.json.');
const config = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!config.enrollmentIds?.length || !config.reason) throw new Error('Specify enrollmentIds and reason.');
const apply = process.argv.includes('--apply');
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
class Rollback extends Error {}
try {
  await db.begin(async tx => {
    await tx`select set_config('app.user_name', 'Corrected program incentives', true)`;
    const accounts = await tx`select enrollment_id, program_id, member_number from member_programs where enrollment_id in ${tx(config.enrollmentIds)} for update`;
    if (accounts.length !== new Set(config.enrollmentIds).size) throw new Error('A scoped account is missing.');
    const collections = await tx`select collection_id, enrollment_id, program_id, or_number, nop_from, nop_to, amount_collected::float8 as amount from collections where enrollment_id in ${tx(config.enrollmentIds)} and status='Posted' for update`;
    if (process.argv.includes('--inspect')) {
      for (const a of accounts) console.log(JSON.stringify({ account: a.enrollment_id, program: a.program_id, receipts: collections.filter(c => c.enrollment_id === a.enrollment_id).map(c => ({ or: c.or_number, nop: [c.nop_from,c.nop_to], amount: c.amount })) }));
      throw new Rollback();
    }
    if (config.expectedCollections != null && collections.length !== config.expectedCollections) throw new Error(`Expected ${config.expectedCollections} collections; found ${collections.length}. Review scope first.`);
    if (collections.some(c => accounts.find(a => a.enrollment_id === c.enrollment_id)?.program_id !== c.program_id)) throw new Error('Collection/account programs disagree.');
    const sales = [];
    for (const a of accounts) sales.push(...await tx`select sale_id from sales where member_number=${a.member_number} and program_id=${a.program_id} for update`);
    if (apply) {
      const before = await tx`select collection_id, program_id, nop_from, nop_to, amount_collected, remittance_amount, forfeited_incentive, remittance_breakdown from collections where collection_id in ${tx(collections.map(c => c.collection_id))}`;
      const links = await tx`select remittance_id, collection_id, amount from remittance_collections where collection_id in ${tx([...collections.map(c => c.collection_id), ...sales.map(s => s.sale_id)])}`;
      const slipIds = [...new Set(links.map(l => l.remittance_id))];
      const slips = slipIds.length ? await tx`select remittance_id, gross_collection, total_remittance, difference from remittances where remittance_id in ${tx(slipIds)}` : [];
      fs.mkdirSync('backups', {recursive:true});
      fs.writeFileSync(`backups/corrected-entry-finance-${Date.now()}.json`, JSON.stringify({accounts: config.enrollmentIds, before, links, slips}, null, 2));
      console.log('Saved financial backup without member personal fields.');
    }
    const result = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: collections.map(c => c.collection_id), saleIds: sales.map(s => s.sale_id) });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry run', accounts: accounts.length, collections: collections.length, sales: sales.length, gross: collections.reduce((sum, c) => sum + c.amount, 0), changed: result.changes.length, previouslyUnpriced: result.previouslyUnpriced, incentiveTotal: result.incentiveTotal, companyShareTotal: result.companyShareTotal, existingIncentiveChange: result.incentiveChange, slips: result.slips }, null, 2));
    for (const a of accounts) {
      const changes = result.changes.filter(c => collections.some(row => row.collection_id === c.id && row.enrollment_id === a.enrollment_id));
      console.log(`${a.enrollment_id}: ${changes.length} financial entries updated`);
    }
    if (result.changes.length) await tx`insert into record_corrections ${tx({ correction_id: `COR-FIN-${Date.now().toString(36).toUpperCase()}`, module: 'Program incentive correction', record_id: config.enrollmentIds.join(','), reason: config.reason, before_json: { entries: result.changes.map(c => ({ id: c.id, kind: c.kind, ...c.before })) }, after_json: { entries: result.changes.map(c => ({ id: c.id, kind: c.kind, program: c.programId, ...c.after })), slips: result.slips }, corrected_at: new Date().toISOString(), encoded_by_name: 'Corrected program incentives', encoded_at: new Date().toISOString() })}`;
    if (!apply) throw new Rollback();
  });
  console.log('Applied. Gross payments and actual remittances were preserved.');
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log('Dry run rolled back.');
} finally { await db.end(); }

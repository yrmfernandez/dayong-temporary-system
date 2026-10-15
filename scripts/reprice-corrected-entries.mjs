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
    const collections = await tx`select collection_id, enrollment_id, program_id, amount_collected::float8 as amount from collections where enrollment_id in ${tx(config.enrollmentIds)} and status='Posted' for update`;
    if (config.expectedCollections != null && collections.length !== config.expectedCollections) throw new Error(`Expected ${config.expectedCollections} collections; found ${collections.length}. Review scope first.`);
    if (collections.some(c => accounts.find(a => a.enrollment_id === c.enrollment_id)?.program_id !== c.program_id)) throw new Error('Collection/account programs disagree.');
    const sales = [];
    for (const a of accounts) sales.push(...await tx`select sale_id from sales where member_number=${a.member_number} and program_id=${a.program_id} for update`);
    const result = await repriceEntries((query, params) => tx.unsafe(query, params), { collectionIds: collections.map(c => c.collection_id), saleIds: sales.map(s => s.sale_id) });
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry run', accounts: accounts.length, collections: collections.length, sales: sales.length, gross: collections.reduce((sum, c) => sum + c.amount, 0), changed: result.changes.length, incentiveChange: result.incentiveChange, companyShareChange: result.companyShareChange, slips: result.slips }, null, 2));
    for (const a of accounts) {
      const changes = result.changes.filter(c => collections.some(row => row.collection_id === c.id && row.enrollment_id === a.enrollment_id));
      console.log(`${a.enrollment_id}: ${changes.length} changed; incentive delta ${-changes.reduce((sum,c) => sum + c.after.remittance - Number(c.before.remittance || 0), 0)}`);
    }
    if (result.changes.length) await tx`insert into record_corrections ${tx({ correction_id: `COR-FIN-${Date.now().toString(36).toUpperCase()}`, module: 'Program incentive correction', record_id: config.enrollmentIds.join(','), reason: config.reason, before_json: { entries: result.changes.map(c => ({ id: c.id, kind: c.kind, ...c.before })) }, after_json: { entries: result.changes.map(c => ({ id: c.id, kind: c.kind, program: c.programId, ...c.after })), slips: result.slips }, corrected_at: new Date().toISOString(), encoded_by_name: 'Corrected program incentives', encoded_at: new Date().toISOString() })}`;
    if (!apply) throw new Rollback();
  });
  console.log('Applied. Gross payments and actual remittances were preserved.');
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log('Dry run rolled back.');
} finally { await db.end(); }

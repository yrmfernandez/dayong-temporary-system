/** Read-only: does Supabase Realtime have a partition for today's broadcasts? (live updates, lib/use-live-refresh.ts)
 * node scripts/prod.mjs node node_modules/tsx/dist/cli.mjs --tsconfig tsconfig.json scripts/_tmp-check-realtime-partitions.mts
 */
import nextEnv from "@next/env";
import { sql } from "drizzle-orm";
import { inTransaction } from "@/lib/db";
import { runAsSystem } from "@/lib/encoder-context";

nextEnv.loadEnvConfig(process.cwd());
const rows = <T,>(result: unknown): T[] => Array.isArray(result) ? result : (result as { rows: T[] }).rows;

runAsSystem(() => inTransaction(async (tx) => {
  await tx.execute(sql`set transaction read only`);
  const [now] = rows<{ utc: string }>(await tx.execute(sql`select now()::text as utc`));
  console.log(`Database time: ${now.utc}`);
  const partitions = rows<{ name: string; bound: string }>(await tx.execute(sql`
    select c.relname as name, pg_get_expr(c.relpartbound, c.oid) as bound
    from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
    where n.nspname = 'realtime' and p.relname = 'messages' order by c.relname`));
  console.log(`realtime.messages partitions: ${partitions.length}`);
  for (const partition of partitions.slice(-10)) console.log(`  ${partition.name}: ${partition.bound}`);
  const [today] = rows<{ covered: boolean }>(await tx.execute(sql`
    select exists (select 1 from pg_inherits i join pg_class c on c.oid = i.inhrelid join pg_class p on p.oid = i.inhparent join pg_namespace n on n.oid = p.relnamespace
      where n.nspname = 'realtime' and p.relname = 'messages' and c.relname = 'messages_' || to_char(now() at time zone 'UTC', 'YYYY_MM_DD')) as covered`));
  console.log(today.covered ? "Today has a partition: broadcasts can be stored." : "Today has NO partition: every live-update broadcast is dropped.");
})).then(() => process.exit(0)).catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });

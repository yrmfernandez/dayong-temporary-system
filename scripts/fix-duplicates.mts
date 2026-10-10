/**
 * Owner decisions on Exceptions → Possible duplicates (October 10, 2026), from config/duplicate-fixes.json:
 *   - deleteCollections: a payment recorded twice; the copy is deleted with lib/admin-delete.ts (its Fidelity rows,
 *     receipt-photo links and copy exceptions go with it; the Audit Log keeps it), and the account's stored payment
 *     status is recalculated.
 *   - applications: one application number on several New Sales of a member. It belongs to the program being paid:
 *     when exactly one of those accounts has payments, the other sales' number becomes "<number> (need edit)" (listed
 *     under Exceptions → Application numbers to complete for staff). Otherwise nothing changes and both are shown.
 * Dry run by default (shows what would happen). Prints member numbers and names for the application (the owner needs
 * them to find the paper form).
 *
 *   npx tsx --tsconfig tsconfig.json scripts/fix-duplicates.mts                          dry run on staging
 *   npm run prod -- npx tsx --tsconfig tsconfig.json scripts/fix-duplicates.mts [--apply]
 */
import fs from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const config = JSON.parse(fs.readFileSync("config/duplicate-fixes.json", "utf8")) as { deleteCollections?: Array<{ id: string; note: string }>; applications?: Array<{ application: string; note: string }> };
const project = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "unknown";
const { runAsSystem } = await import("../lib/encoder-context");
const { planDeletion, deleteRecord } = await import("../lib/admin-delete");
const { getDb, inTransaction } = await import("../lib/db");
const { sql } = await import("drizzle-orm");
const { accountState, todayInManila } = await import("../lib/account-rules");
const { loadAccountData } = await import("../lib/account-data");
const rowsOf = <T,>(result: unknown): T[] => (Array.isArray(result) ? result : (result as { rows?: T[] })?.rows ?? []) as T[];
const peso = (value: number) => `₱${Number(value).toLocaleString("en-PH")}`;

await runAsSystem(async () => {
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run"}\n`);
  for (const item of config.deleteCollections ?? []) {
    const [row] = rowsOf<{ enrollment_id: string; or_number: string; or_date: string; amount: number; month_from: string }>(await getDb().execute(sql`select enrollment_id, or_number, or_date::text as or_date, amount_collected::float8 as amount, month_from from collections where collection_id = ${item.id}`));
    if (!row) { console.log(`${item.id}: already gone.\n`); continue; }
    const plan = await planDeletion("collection", item.id);
    console.log(`Delete ${item.id} · OR ${row.or_number} ${row.or_date} · ${peso(row.amount)} · ${row.month_from}${plan.blockers.length ? ` · BLOCKED: ${plan.blockers.join(" ")}` : ""}`);
    if (apply && !plan.blockers.length) {
      await deleteRecord("collection", item.id, item.note);
      // Its account's stored payment status follows the payments that remain.
      const data = await loadAccountData({ enrollmentIds: [row.enrollment_id] });
      const account = data.accounts[0];
      if (account) {
        const state = accountState(account, data.payments.filter((payment) => payment.enrollmentId === account.id), todayInManila());
        await getDb().execute(sql`update member_programs set account_status = ${state.status} where enrollment_id = ${account.id}`);
        console.log(`   deleted; account ${account.id} is now ${state.status}`);
      }
    }
    console.log("");
  }
  for (const item of config.applications ?? []) {
    const key = item.application.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const sales = rowsOf<{ sale_id: string; member_number: string; name: string; program: string; program_id: string; date: string; amount: number; payments: number; account: string | null }>(await getDb().execute(sql`
      select s.sale_id, s.member_number, trim(concat_ws(' ', m.first_name, m.middle_name, m.surname)) as name, coalesce(p.program_code, p.program_name) as program, s.program_id,
        coalesce(s.or_date::text, s.date_remitted::text, '') as date, coalesce(s.amount_paid, 0)::float8 as amount, mp.enrollment_id as account,
        (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id and lower(coalesce(c.status, '')) = 'posted') as payments
      from sales s left join members m on m.member_number = s.member_number left join programs p on p.program_id = s.program_id
        left join member_programs mp on mp.member_number = s.member_number and mp.program_id = s.program_id
      where s.application_key = ${key} order by s.sale_id`));
    console.log(`Application ${item.application}: ${sales.length} New Sale(s)`);
    for (const sale of sales) console.log(`   ${sale.sale_id} · ${sale.member_number} ${sale.name} · ${sale.program} · ${sale.date} · ${peso(sale.amount)} · account ${sale.account ?? "none"} · ${sale.payments} payment(s)`);
    const paid = sales.filter((sale) => sale.payments > 0);
    if (paid.length !== 1) { console.log(`   ${paid.length ? "More than one" : "None"} of these accounts has payments: left for staff to decide from the paper form.\n`); continue; }
    const others = sales.filter((sale) => sale !== paid[0]);
    console.log(`   Belongs to ${paid[0].program} (the program being paid). ${apply ? "Marked" : "Would mark"} ${others.map((sale) => sale.sale_id).join(", ")} as "${item.application} (need edit)".`);
    if (apply) await inTransaction(async (tx) => {
      for (const sale of others) await tx.execute(sql`update sales set application_no = ${`${item.application} (need edit)`}, legacy_duplicate = false where sale_id = ${sale.sale_id}`);
    });
    console.log("");
  }
  console.log(apply ? "Applied." : "Dry run: nothing was written. Add --apply to make the changes.");
});
process.exit(0);

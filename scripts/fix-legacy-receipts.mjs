/**
 * Owner-confirmed fixes to imported old-sheet data (October 9, 2026), listed in config/legacy-receipt-fixes.json:
 *   - memberMerges: one person imported as two members (each with a different program). The other member's accounts,
 *     collections, transfers, beneficiaries and New Sales move to the kept member (and its member number); the other
 *     member is deleted. Refused when both hold an account in the same program.
 *   - receipts: an old-sheet collection row (still in Legacy Pending COLL) that belongs to another program of the same
 *     member, e.g. a ₱300 D-300 (BRACKETING) payment filed under D-350 (5Y). It is added to that account with the ID the
 *     importer would give it, the account's payments are renumbered NOP by NOP in OR-date order (the October 4 repair
 *     rule; months follow from the DOI), and its payment status is recalculated (lib/account-rules.ts).
 *   - moves: a payment already in the database that sits on the wrong program's account of its member (e.g. a D-350
 *     account created only by that one misfiled receipt) moves to the right account, renumbered as above.
 *   - deleteAccounts (run last, after the moves): an account the owner says should not exist (e.g. an application recorded in both old systems
 *     under different programs). The account, its New Sale and that sale's beneficiaries are deleted; refused when it has
 *     payments, transfers, or a New Sale on a remittance slip. The Audit Log keeps every deleted row.
 *
 *   node scripts/fix-legacy-receipts.mjs                      dry run on staging (every change made, then rolled back)
 *   node scripts/fix-legacy-receipts.mjs --apply              apply on staging
 *   npm run prod -- node scripts/fix-legacy-receipts.mjs [--apply]
 *
 * With --apply on production, the receipts' rows are then removed from the shared Legacy Pending COLL tab (never on
 * staging, which shares that sheet). One transaction; every change is in the Audit Log and summarized in Record
 * Corrections. Prints IDs, program codes, NOPs, months, dates and amounts only.
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { google } from "googleapis";
import postgres from "postgres";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const PRODUCTION = "qnugejonwpfvsenxvhxz";
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const sql = postgres(url, { max: 1, onnotice: () => {} });
const config = JSON.parse(fs.readFileSync("config/legacy-receipt-fixes.json", "utf8"));
const today = todayInManila();
const text = (value) => String(value ?? "").trim();
// Same IDs as scripts/migrate-legacy-members.mjs, so the importer treats these rows as already imported.
const hashId = (prefix, ...parts) => `${prefix}-LEG-${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10).toUpperCase()}`;
const entryKey = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const now = new Date().toISOString();
const correction = (tx, module, recordId, reason, before, after) => tx`insert into record_corrections ${tx({
  correction_id: `COR-LFX-${recordId}-${Date.now().toString(36).toUpperCase()}`, module, record_id: recordId, reason, before_json: before, after_json: after,
  corrected_at: now, encoded_by_name: "Legacy fix", encoded_at: now })}`;

// The pending rows the receipts come from (Legacy Pending COLL, shared Google Sheet).
const auth = new google.auth.GoogleAuth({ credentials: { client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL, private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n") }, scopes: ["https://www.googleapis.com/auth/spreadsheets"] });
const sheets = google.sheets({ version: "v4", auth });
const PENDING = "Legacy Pending COLL";
const pending = (await sheets.spreadsheets.values.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, range: `'${PENDING}'` })).data.values ?? [];
const header = (pending[0] ?? []).map((name) => text(name).toUpperCase());
const cell = (row, name) => text(row[header.indexOf(name)]);
const refOf = (row) => `${cell(row, "SOURCE")}|${cell(row, "SOURCE TAB")}|${Number(cell(row, "SOURCE ROW"))}`;
const isoDate = (value) => { const v = text(value); if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10); const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : ""; };

/**
 * Renumbers every posted payment of an account in OR-date order (months follow from the DOI) after `id` was added or
 * moved onto it, and recalculates its status. Payments already there keep the months they cover; `id` covers `months`
 * (owner) or its amount at the program rate (a flexible program's month is any amount from its minimum). A payment
 * older than every other one goes before them (NOP 59 when the account starts at NOP 60); NOP 1 stays the New Sale's.
 */
async function renumber(tx, account, id, months, label) {
  // Renumber every posted payment of the account in OR-date order; months follow from the DOI.
  const payments = await tx`select collection_id, or_date::text as or_date, or_number, amount_collected::float8 as amount, nop_from, nop_to, month_from, month_to from collections where enrollment_id = ${account.enrollment_id} and status = 'Posted' order by or_date, collection_id`;
  const others = payments.filter((p) => p.collection_id !== id);
  // Payments already on the account keep the months they cover; the added receipt covers `months` (owner) or
  // its amount at the program rate. A flexible program's month is any amount from its minimum.
  const monthsOf = (p) => p.collection_id !== id && p.nop_to >= p.nop_from && p.nop_from > 0 ? p.nop_to - p.nop_from + 1
    : months ?? (account.flexible ? 1 : Math.round(p.amount * 100) / Math.round(account.rate * 100));
  const first = others.length ? Math.min(...others.map((p) => p.nop_from)) : 2;
  // A receipt older than every payment on the account comes before them (e.g. NOP 59 when the account starts at
  // NOP 60), instead of pushing them all a month later; NOP 1 stays the New Sale's.
  const addedFirst = payments[0]?.collection_id === id && others.length > 0;
  let next = addedFirst && first - monthsOf(payments[0]) >= 2 ? first - monthsOf(payments[0]) : first;
  const lines = [];
  const renumbered = payments.map((p) => {
    const count = monthsOf(p);
    if (!Number.isInteger(count) || count < 1) throw new Error(`${label}: a ₱${p.amount} payment is not a whole number of ₱${account.rate} months.`);
    const nopFrom = next, nopTo = next + count - 1; next = nopTo + 1;
    const monthFrom = monthName(monthIndex(account.doi.slice(0, 7)) + nopFrom - 1), monthTo = monthName(monthIndex(account.doi.slice(0, 7)) + nopTo - 1);
    lines.push(`   OR ${p.or_date} · ₱${p.amount} · NOP ${p.collection_id === id ? "new" : `${p.nop_from}`} → ${nopFrom}${nopTo > nopFrom ? `-${nopTo}` : ""} (${monthFrom}${monthTo !== monthFrom ? `..${monthTo}` : ""})${p.collection_id === id ? "  ← added" : ""}`);
    return { ...p, nopFrom, nopTo, monthFrom, monthTo };
  });
  for (const p of renumbered) await tx`update collections set nop_from = ${p.nopFrom}, nop_to = ${p.nopTo}, month_from = ${p.monthFrom}, month_to = ${p.monthTo} where collection_id = ${p.collection_id}`;
  const state = accountState({ id: account.enrollment_id, memberId: account.member_id, memberNumber: "", programId: account.program_id, doi: account.doi, branch: "", mas: "", basePay: account.rate, payBalanceTotal: account.total, storedStatus: "", flexible: account.flexible, maxMonthlyPayment: account.max },
    renumbered.map((p) => ({ id: p.collection_id, enrollmentId: account.enrollment_id, orDate: p.or_date, orNumber: text(p.or_number), monthFrom: p.monthFrom, monthTo: p.monthTo, nopFrom: p.nopFrom, nopTo: p.nopTo, amount: p.amount, dateRemitted: "", mas: "" })), today);
  await tx`update member_programs set account_status = ${state.status} where enrollment_id = ${account.enrollment_id}`;
  return { payments, renumbered, lines, state };
}

class Rollback extends Error {}
const removeRefs = [];
try {
  console.log(`Supabase project: ${project}${project === PRODUCTION ? " (production)" : ""} · ${config.memberMerges?.length ?? 0} member merge(s), ${config.receipts?.length ?? 0} receipt(s), ${config.moves?.length ?? 0} move(s), ${config.deleteAccounts?.length ?? 0} delete(s)${apply ? "" : " · dry run"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', 'Legacy fix', true)`;

    for (const merge of config.memberMerges ?? []) {
      const [keep] = await tx`select member_id, member_number from members where member_id = ${merge.keep}`;
      const [other] = await tx`select member_id, member_number from members where member_id = ${merge.other}`;
      if (!other) { console.log(`Merge ${merge.other} → ${merge.keep}: already done (${merge.other} is gone).`); continue; }
      if (!keep) throw new Error(`Merge: kept member ${merge.keep} not found.`);
      const clash = await tx`select p.program_code from member_programs a join member_programs b on b.program_id = a.program_id join programs p on p.program_id = a.program_id where a.member_id = ${keep.member_id} and b.member_id = ${other.member_id}`;
      if (clash.length) throw new Error(`Merge ${other.member_id} → ${keep.member_id}: both have ${clash.map((row) => row.program_code).join(", ")}; merge those accounts first.`);
      const moved = {
        accounts: (await tx`update member_programs set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning enrollment_id`).map((row) => row.enrollment_id),
        collections: (await tx`update collections set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning collection_id`).length,
        transfers: (await tx`update member_transfers set member_id = ${keep.member_id}, member_number = ${keep.member_number} where member_id = ${other.member_id} returning transfer_id`).length,
        beneficiaries: (await tx`update beneficiaries set member_id = ${keep.member_id} where member_id = ${other.member_id} returning member_id`).length,
        sales: (await tx`update sales set member_number = ${keep.member_number} where member_number = ${other.member_number} returning sale_id`).length,
      };
      await tx`delete from members where member_id = ${other.member_id}`;
      await correction(tx, "Member merge", other.member_id, merge.note, { member: other.member_id, memberNumber: other.member_number }, { member: keep.member_id, memberNumber: keep.member_number, ...moved });
      console.log(`Merge ${other.member_id} (${other.member_number}) → ${keep.member_id} (${keep.member_number}): ${moved.accounts.length} account(s) ${moved.accounts.join(", ")}, ${moved.collections} collection(s), ${moved.transfers} transfer(s), ${moved.beneficiaries} beneficiar(ies), ${moved.sales} New Sale(s) moved; ${other.member_id} deleted.`);
    }

    for (const fix of config.receipts ?? []) {
      const row = pending.slice(1).find((item) => refOf(item) === fix.row);
      const id = hashId("COL", fix.row);
      const [done] = await tx`select collection_id from collections where collection_id = ${id}`;
      if (done) { console.log(`\n${fix.row}: already added (${id}).`); if (row) removeRefs.push(fix.row); continue; }
      if (!row) throw new Error(`${fix.row}: not found in ${PENDING}.`);
      const accounts = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.doi::text as doi, mp.program_id, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.flexible, p.max_monthly_payment::float8 as max, mp.account_status
        from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${fix.member} and p.program_code = ${fix.program}`;
      if (accounts.length !== 1) throw new Error(`${fix.row}: member ${fix.member} has ${accounts.length} ${fix.program} account(s); expected one.`);
      const account = accounts[0];
      const orNumber = cell(row, "OR NUMBER"), orDate = isoDate(cell(row, "OR DATE")), amount = Number(cell(row, "AMOUNT COLLECTED").replace(/[^0-9.]/g, "")), dateRemitted = isoDate(cell(row, "DATE REMITTED"));
      if (!orDate || !(amount > 0)) throw new Error(`${fix.row}: OR date or amount unreadable.`);
      const [sibling] = await tx`select * from collections where enrollment_id = ${account.enrollment_id} and status = 'Posted' order by or_date desc limit 1`;
      if (!sibling) throw new Error(`${fix.row}: ${account.enrollment_id} has no posted payment to copy the branch, MAS and remittance details from.`);
      const [used] = entryKey(orNumber) ? await tx`select collection_id from collections where or_key = ${entryKey(orNumber)} and status = 'Posted' and not legacy_duplicate limit 1` : [];
      const { row_seq, branch_id, mas_employee_id, or_key, ...copy } = sibling;
      await tx`insert into collections ${tx({
        ...copy, collection_id: id, collection_batch_id: hashId("CBT", fix.row), or_number: orNumber, or_date: orDate, amount_collected: amount, date_remitted: dateRemitted || null,
        nop_from: 0, nop_to: 0, month_from: "", month_to: "", remittance_status: "Remitted", linked_remittance_id: null, payment_reference: null, penalty_amount: null, penalty_note: null,
        fidelity_amount: null, forfeited_incentive: null, backdate_reason: null, legacy_duplicate: Boolean(used), created_at: now, encoded_by_user_id: null, encoded_by_employee_id: null,
        encoded_by_name: "Legacy fix", encoded_at: now })}`;

      const { payments, renumbered, lines, state } = await renumber(tx, account, id, fix.months, fix.row);
      await correction(tx, "Legacy receipt", id, fix.note, { row: fix.row, payments: payments.map((p) => ({ id: p.collection_id, nop: `${p.nop_from}-${p.nop_to}` })), status: account.account_status },
        { enrollment: account.enrollment_id, payments: renumbered.map((p) => ({ id: p.collection_id, nop: `${p.nopFrom}-${p.nopTo}` })), status: state.status });
      console.log(`\n${fix.row} → ${account.enrollment_id} ${fix.program} (member ${account.member_id}, DOI ${account.doi})${used ? " · OR number already used, added flagged as a duplicate" : ""}`);
      for (const line of lines) console.log(line);
      console.log(`   status ${account.account_status || "—"} → ${state.status}`);
      removeRefs.push(fix.row);
    }

    for (const move of config.moves ?? []) {
      const [payment] = await tx`select c.collection_id, c.enrollment_id, c.member_id, c.or_date::text as or_date, c.amount_collected::float8 as amount, c.nop_from, c.nop_to, p.program_code
        from collections c join programs p on p.program_id = c.program_id where c.collection_id = ${move.collection}`;
      if (!payment) throw new Error(`Move ${move.collection}: payment not found.`);
      const accounts = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.doi::text as doi, mp.program_id, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.flexible, p.max_monthly_payment::float8 as max, mp.account_status
        from member_programs mp join programs p on p.program_id = mp.program_id where mp.member_id = ${move.member} and p.program_code = ${move.program}`;
      if (accounts.length !== 1) throw new Error(`Move ${move.collection}: member ${move.member} has ${accounts.length} ${move.program} account(s); expected one.`);
      const account = accounts[0];
      if (payment.enrollment_id === account.enrollment_id) { console.log(`\nMove ${move.collection}: already on ${account.enrollment_id} ${move.program}.`); continue; }
      if (payment.member_id !== account.member_id) throw new Error(`Move ${move.collection}: it belongs to member ${payment.member_id}, not ${account.member_id}.`);
      await tx`update collections set enrollment_id = ${account.enrollment_id}, program_id = ${account.program_id}, member_number = ${account.member_number} where collection_id = ${payment.collection_id}`;
      const { payments, renumbered, lines, state } = await renumber(tx, account, payment.collection_id, move.months, move.collection);
      await correction(tx, "Legacy receipt", payment.collection_id, move.note, { enrollment: payment.enrollment_id, program: payment.program_code, nop: `${payment.nop_from}-${payment.nop_to}`, payments: payments.filter((p) => p.collection_id !== payment.collection_id).map((p) => ({ id: p.collection_id, nop: `${p.nop_from}-${p.nop_to}` })), status: account.account_status },
        { enrollment: account.enrollment_id, program: move.program, payments: renumbered.map((p) => ({ id: p.collection_id, nop: `${p.nopFrom}-${p.nopTo}` })), status: state.status });
      console.log(`\nMove ${payment.collection_id} (${payment.program_code} ${payment.enrollment_id}, OR ${payment.or_date}, ₱${payment.amount}) → ${account.enrollment_id} ${move.program} (member ${account.member_id}, DOI ${account.doi})`);
      for (const line of lines) console.log(line.replace("← added", "← moved"));
      console.log(`   status ${account.account_status || "—"} → ${state.status}`);
    }

    for (const remove of config.deleteAccounts ?? []) {
      const [account] = await tx`select mp.enrollment_id, mp.member_id, mp.member_number, mp.program_id, p.program_code, mp.doi::text as doi, mp.account_status from member_programs mp join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${remove.enrollment}`;
      if (!account) { console.log(`
Delete ${remove.enrollment}: already done.`); continue; }
      const [{ payments }] = await tx`select count(*)::int as payments from collections where enrollment_id = ${account.enrollment_id}`;
      const [{ transfers }] = await tx`select count(*)::int as transfers from member_transfers where enrollment_id = ${account.enrollment_id}`;
      if (payments || transfers) throw new Error(`Delete ${account.enrollment_id}: it has ${payments} payment(s) and ${transfers} transfer(s); not deleted.`);
      const sales = await tx`select sale_id, or_date::text as or_date, amount_paid::float8 as amount, remittance_status, linked_remittance_id from sales where member_number = ${account.member_number} and program_id = ${account.program_id}`;
      if (sales.some((sale) => sale.linked_remittance_id)) throw new Error(`Delete ${account.enrollment_id}: its New Sale is on remittance slip ${sales.find((sale) => sale.linked_remittance_id).linked_remittance_id}; not deleted.`);
      const ids = sales.map((sale) => sale.sale_id);
      const beneficiaries = ids.length ? (await tx`delete from beneficiaries where sale_id in ${tx(ids)} returning beneficiary_id`).length : 0;
      if (ids.length) await tx`delete from sales where sale_id in ${tx(ids)}`;
      await tx`delete from member_programs where enrollment_id = ${account.enrollment_id}`;
      await correction(tx, "Account delete", account.enrollment_id, remove.note, { account: account.enrollment_id, member: account.member_id, program: account.program_code, doi: account.doi, status: account.account_status, sales: sales.map((sale) => ({ id: sale.sale_id, orDate: sale.or_date, amount: sale.amount, remittance: sale.remittance_status })) }, { deleted: true, beneficiaries });
      console.log(`
Delete ${account.enrollment_id} · ${account.program_code} · member ${account.member_id} · DOI ${account.doi} · ${account.account_status}: ${sales.length} New Sale(s) ${sales.map((sale) => `${sale.sale_id} ₱${sale.amount} ${sale.or_date} ${sale.remittance_status}`).join(", ")}, ${beneficiaries} beneficiar(ies), account deleted.`);
    }

    if (!apply) throw new Rollback();
  });
} catch (error) {
  if (!(error instanceof Rollback)) { await sql.end(); throw error; }
}
await sql.end();

// The receipts' pending rows leave the shared Legacy Pending COLL tab, on production only.
if (removeRefs.length) {
  if (!apply || project !== PRODUCTION) console.log(`\n${removeRefs.length} row(s) ${apply ? "stay" : "would leave"} ${PENDING}${apply ? " (staging shares that sheet; removed only on production)" : " on --apply against production"}.`);
  else {
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.GOOGLE_SHEET_ID, fields: "sheets.properties" });
    const sheetId = meta.data.sheets.find((item) => item.properties.title === PENDING).properties.sheetId;
    const indexes = pending.map((row, index) => (index > 0 && removeRefs.includes(refOf(row)) ? index : -1)).filter((index) => index > 0).sort((a, b) => b - a);
    if (indexes.length) await sheets.spreadsheets.batchUpdate({ spreadsheetId: process.env.GOOGLE_SHEET_ID, requestBody: { requests: indexes.map((index) => ({ deleteDimension: { range: { sheetId, dimension: "ROWS", startIndex: index, endIndex: index + 1 } } })) } });
    console.log(`\nRemoved ${indexes.length} row(s) from ${PENDING}.`);
  }
}
if (!apply) console.log("\nDry run: every change above was made inside a transaction and rolled back. Add --apply to keep them.");

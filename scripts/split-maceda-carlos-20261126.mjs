/**
 * Maceda, Carlos (owner request, November 26, 2026). He pays D-320 in Pantukan but was never in the system: the 2025
 * workbook (tab "DDN - COL.") has his four 2025 receipts, and the 2026 workbook's "Adjustments 2026" row 969 (Pañares,
 * Nimfa, August 26, 2026, not ticked done) says his payment was entered under MACEDA MACAIRE (PH-48503609, D-210 HG).
 * That payment is OR 0592 T (August 11, 2026, ₱2,560 = 8 × ₱320, not a whole number of ₱210 or ₱150 months).
 *
 *   - new member MACEDA, CARLOS with a D-320 account, Pantukan, MAS Pañares, Nimfa (MAS of his latest receipts);
 *     DOI August 1, 2024, worked back from his NOPs (NOP 5 = December 2024 … NOP 15 = October 2025), the importer's
 *     rule for payers with no New Sale; no birthdate, address or contact invented;
 *   - his four 2025 receipts added with the importer's IDs (hash of workbook|tab|row) and remitted on the OR date,
 *     left unpriced like the earlier 2025-workbook import (Lugon); OR 4620 is also a 2026 Hinatuan receipt, so it is
 *     flagged legacy_duplicate as the importer does;
 *   - OR 0592 T moved to his account as NOP 22–29 (May–December 2026, after his advance to April 2026);
 *   - Macaire's later receipts renumbered to close the gap: 277 P NOP 34 → 26 … 00632P NOP 37 → 29 (August–November
 *     2026, the months they were paid in);
 *   - the moved and renumbered receipts repriced (lib/entry-finance.mjs, linked remittances follow); both statuses
 *     recalculated.
 * One transaction; dry run (default) makes every change, prints it, then rolls back. Audit Log keeps every row and
 * Record Corrections a summary. Prints IDs, OR numbers, NOPs, months, dates and amounts only.
 *
 *   npm run prod -- node scripts/split-maceda-carlos-20261126.mjs           dry run on production
 *   npm run prod -- node scripts/split-maceda-carlos-20261126.mjs --apply
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, forfeitMonthsFor, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";
import { repriceEntries } from "../lib/entry-finance.mjs";
import { loadLegacySources } from "./legacy-sources.mjs";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const ENCODER = "Maceda Carlos split";
const today = todayInManila();
const now = new Date().toISOString();
const text = (v) => String(v ?? "").trim();
const key = (v) => text(v).toUpperCase().replace(/[^A-Z0-9]/g, "");
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : text(v).slice(0, 10));
const hashId = (prefix, ...parts) => `${prefix}-LEG-${createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 10).toUpperCase()}`;
const monthOf = (doi, nop) => monthName(monthIndex(doi.slice(0, 7)) + nop - 1);
class Rollback extends Error {}

const MACAIRE = { memberNumber: "PH-48503609", memberId: "MEM-LEG-8D198B566F", enrollmentId: "ENR-LEG-7EBF268D32", programId: "DP-0005", doi: "2024-07-01" };
const PROGRAM = "DP-0011"; // D-320
const BRANCH = { id: "BR-0013", code: "PANTUKAN" };
const MAS = { NIMFA: { id: "DNDO-2026-0003", name: "PAÑARES, NIMFA" }, MARICEL: { id: "LEG-2026-0013", name: "BALAIS, MARICEL" } };
const CARLOS = { surname: "MACEDA", firstName: "CARLOS", doi: "2024-08-01" };
const FILE = "legacy-data/old-data/2025 - DATABASE (NS + COLL).xlsx";
const TAB = "DDN - COL.";
const OLD = [ // 2025 workbook rows, checked against the file before anything is written
  { row: 35, or: "4620", orDate: "2025-01-02", amount: 640, nop: [5, 6], agent: "Balais, M.", mas: MAS.MARICEL },
  { row: 2227, or: "5684", orDate: "2025-02-18", amount: 960, nop: [7, 9], agent: "Pañares, N.", mas: MAS.NIMFA },
  { row: 7639, or: "10352", orDate: "2025-06-11", amount: 1600, nop: [10, 14], agent: "Pañares, N.", mas: MAS.NIMFA },
  { row: 13013, or: "7725N", orDate: "2025-10-15", amount: 2240, nop: [15, 21], agent: "Pañares, N.", mas: MAS.NIMFA },
];
const MOVE = { id: "COL-LEG-AF0F64EC62", or: "0592 T", amount: 2560, from: [26, 33], to: [22, 29] };
const RENUMBER = [
  { id: "COL-LEG-60CFE5AF04", or: "277 P (duplicated)", from: 34, to: 26 },
  { id: "COL-LEG-BCAF695D91", or: "00271P", from: 35, to: 27 },
  { id: "COL-20261028061623-3BHL", or: "00345P", from: 36, to: 28 },
  { id: "COL-20261126033220-2QA6", or: "00632P", from: 37, to: 29 },
];
const KEEP = ["COL-LEG-1F62453FAF", "COL-LEG-90B51FAB5B", "COL-LEG-B06C60570D", "COL-LEG-6C78F81F58", "COL-LEG-F3D6AA6984"]; // NOP 19–25, unchanged

// 1. Source rows.
const sourceHash = createHash("sha256").update(readFileSync(FILE)).digest("hex");
const [source] = await loadLegacySources([FILE]);
const tab = source.tabs.find((t) => t.title === TAB);
if (!tab) throw new Error(`Tab ${TAB} missing.`);
const headers = tab.rows[0];
for (const item of OLD) {
  const row = tab.rows[item.row - tab.firstRow];
  const cell = (name) => row?.[headers.findIndex((h) => key(h) === key(name))];
  const nops = text(cell("NOP")).split(/[^0-9]+/).filter(Boolean).map(Number);
  const nameKey = key(cell("PH/MEMBER"));
  if (!(nameKey === "MACEDACARLOS" || nameKey === "CARLOSMACEDA") || key(cell("OR NUMBER")) !== key(item.or) || day(cell("OR DATE")) !== item.orDate
    || Number(cell("AMOUNT COLLECTED")) !== item.amount || nops[0] !== item.nop[0] || nops.at(-1) !== item.nop[1] || key(cell("DAYONG PROGRAM")) !== "D320"
    || key(cell("BRANCH")) !== "PANTUKAN" || key(cell("MARKETING AGENT")) !== key(item.agent))
    throw new Error(`Source row ${item.row} differs from the reviewed values.`);
  item.ref = `${source.title}|${TAB}|${item.row}`;
  item.timestamp = cell("Timestamp");
  item.suspended = text(cell("IF SUSPENDED"));
  item.reactivation = /^(yes|y|true|1)$/i.test(text(cell("REACTIVATION")));
  item.transferred = /^(yes|y|true|1)$/i.test(text(cell("TRANSFERRED")));
  if (item.amount !== 320 * (item.nop[1] - item.nop[0] + 1)) throw new Error(`OR ${item.or}: not whole D-320 months.`);
  if (monthOf(CARLOS.doi, item.nop[0]) > item.orDate.slice(0, 7) && item.row !== 13013) throw new Error(`OR ${item.or}: NOP months do not fit the DOI.`);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });

async function statusOf(tx, enrollmentId) {
  const [a] = await tx`select mp.enrollment_id, mp.member_id, mp.doi::text as doi, mp.program_id, p.base_pay::float8 as rate, coalesce(p.pay_balance_total, 0)::float8 as total, p.flexible, p.max_monthly_payment::float8 as max, p.category_id
    from member_programs mp join programs p on p.program_id = mp.program_id where mp.enrollment_id = ${enrollmentId}`;
  const payments = await tx`select collection_id, or_date::text as or_date, or_number, amount_collected::float8 as amount, nop_from, nop_to, month_from, month_to from collections where enrollment_id = ${enrollmentId} and status = 'Posted' order by or_date, collection_id`;
  const state = accountState({ id: a.enrollment_id, memberId: a.member_id, memberNumber: "", programId: a.program_id, doi: a.doi, branch: "", mas: "", basePay: a.rate, payBalanceTotal: a.total, storedStatus: "", flexible: a.flexible, maxMonthlyPayment: a.max, forfeitMonths: forfeitMonthsFor(a.category_id) },
    payments.map((p) => ({ id: p.collection_id, enrollmentId, orDate: p.or_date, orNumber: text(p.or_number), monthFrom: p.month_from, monthTo: p.month_to, nopFrom: p.nop_from, nopTo: p.nop_to, amount: p.amount, dateRemitted: "", mas: "" })), today);
  await tx`update member_programs set account_status = ${state.status} where enrollment_id = ${enrollmentId}`;
  return state.status;
}

try {
  console.log(`Supabase project: ${project}${apply ? "" : " · dry run (changes made, then rolled back)"}\n`);
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', ${ENCODER}, true)`;
    await tx`select pg_advisory_xact_lock(hashtext('split-maceda-carlos-20261126'))`;

    const memberId = hashId("MEM", "COLL", `${TAB}|${["CARLOS", "MACEDA"].sort().join(" ")}`);
    const enrollmentId = hashId("ENR", memberId, PROGRAM);
    const [already] = await tx`select member_number from members where member_id = ${memberId}`;
    if (already) { console.log(`Already done: ${already.member_number}.`); return; }

    // 2. Snapshot guards.
    const [program] = await tx`select program_name, base_pay::float8 as rate from programs where program_id = ${PROGRAM}`;
    if (program?.program_name !== "D-320" || program.rate !== 320) throw new Error("D-320 program differs.");
    const [macaire] = await tx`select m.member_id, mp.enrollment_id, mp.program_id, mp.doi::text as doi, mp.account_status from members m join member_programs mp on mp.member_id = m.member_id where m.member_number = ${MACAIRE.memberNumber} for update`;
    if (!macaire || macaire.member_id !== MACAIRE.memberId || macaire.enrollment_id !== MACAIRE.enrollmentId || macaire.program_id !== MACAIRE.programId || macaire.doi !== MACAIRE.doi) throw new Error("Macaire's account differs from the reviewed snapshot.");
    const receipts = await tx`select collection_id, or_number, amount_collected::float8 as amount, nop_from, nop_to, status from collections where enrollment_id = ${MACAIRE.enrollmentId} for update`;
    const expected = [...KEEP, MOVE.id, ...RENUMBER.map((r) => r.id)];
    if (receipts.length !== expected.length || receipts.some((r) => !expected.includes(r.collection_id) || r.status !== "Posted")) throw new Error("Macaire's receipts changed since review.");
    const byId = new Map(receipts.map((r) => [r.collection_id, r]));
    const moved = byId.get(MOVE.id);
    if (text(moved.or_number) !== MOVE.or || moved.amount !== MOVE.amount || moved.nop_from !== MOVE.from[0] || moved.nop_to !== MOVE.from[1]) throw new Error("OR 0592 T differs.");
    for (const r of RENUMBER) { const row = byId.get(r.id); if (text(row.or_number) !== r.or || row.nop_from !== r.from || row.nop_to !== r.from) throw new Error(`OR ${r.or} differs.`); }
    const near = await tx`select member_number from members where concat_ws(' ', surname, first_name, middle_name) ilike '%maceda%' and concat_ws(' ', surname, first_name, middle_name) ilike '%carlos%'`;

    // 3. Member and account.
    if (near.length) throw new Error(`A Maceda Carlos member already exists: ${near.map((r) => r.member_number).join(", ")}.`);
    let n = parseInt(createHash("sha1").update(memberId).digest("hex").slice(0, 12), 16) % 100_000_000;
    while ((await tx`select 1 from members where member_number = ${`PH-${String(n).padStart(8, "0")}`}`).length) n = (n + 1) % 100_000_000;
    const number = `PH-${String(n).padStart(8, "0")}`;
    const stamp = { encoded_by_name: ENCODER, encoded_at: now };
    const created = new Date(OLD[0].timestamp instanceof Date ? OLD[0].timestamp.getTime() - 8 * 3600000 : Date.parse(now)).toISOString();
    await tx`insert into members ${tx({ member_id: memberId, member_number: number, surname: CARLOS.surname, first_name: CARLOS.firstName, claimant_same_address: false, status: "Active", ...stamp })}`;
    await tx`insert into member_programs ${tx({ enrollment_id: enrollmentId, member_id: memberId, member_number: number, program_id: PROGRAM, doi: CARLOS.doi, branch: BRANCH.code, branch_id: BRANCH.id, mas: MAS.NIMFA.name, mas_employee_id: MAS.NIMFA.id, remittance_method: "Cash", registration_fee: false, status: "Active", date_created: created, ...stamp })}`;
    console.log(`New member ${number} MACEDA, CARLOS (${memberId}), D-320 account ${enrollmentId}, DOI ${CARLOS.doi}, MAS ${MAS.NIMFA.name}`);

    // 4. 2025 receipts.
    for (const item of OLD) {
      const id = hashId("COL", item.ref);
      const taken = (await tx`select 1 from collections where or_key = ${key(item.or)} and status = 'Posted' and not legacy_duplicate`).length > 0
        || (await tx`select 1 from sales where upper(regexp_replace(coalesce(or_number, ''), '[^A-Za-z0-9]', '', 'g')) = ${key(item.or)}`).length > 0;
      const monthFrom = monthOf(CARLOS.doi, item.nop[0]), monthTo = monthOf(CARLOS.doi, item.nop[1]);
      await tx`insert into collections ${tx({ collection_id: id, collection_batch_id: hashId("CBT", TAB, BRANCH.code, item.mas.name, item.orDate), enrollment_id: enrollmentId, member_id: memberId, member_number: number, program_id: PROGRAM,
        branch: BRANCH.code, branch_id: BRANCH.id, mas: item.mas.name, mas_employee_id: item.mas.id, or_number: item.or, or_date: item.orDate, amount_collected: item.amount, month_from: monthFrom, month_to: monthTo, nop_from: item.nop[0], nop_to: item.nop[1],
        reactivation: item.reactivation, transferred: item.transferred, suspended: item.suspended, status: "Posted", created_at: item.timestamp instanceof Date ? new Date(item.timestamp.getTime() - 8 * 3600000).toISOString() : now,
        collected_by_role: "MAS", remittance_status: "Remitted", accountable_employee_id: item.mas.id, accountable_name: item.mas.name, accountable_role: "MAS", remittance_method: "Cash", date_remitted: item.orDate, legacy_duplicate: taken, ...stamp })}`;
      console.log(`   add  OR ${item.or} ${item.orDate} ₱${item.amount} · NOP ${item.nop.join("–")} (${monthFrom} to ${monthTo}) ${item.mas.name}${taken ? " · OR also used elsewhere, flagged legacy duplicate" : ""}`);
    }

    // 5. Move 0592 T; 6. renumber Macaire.
    const mFrom = monthOf(CARLOS.doi, MOVE.to[0]), mTo = monthOf(CARLOS.doi, MOVE.to[1]);
    await tx`update collections set enrollment_id = ${enrollmentId}, member_id = ${memberId}, member_number = ${number}, program_id = ${PROGRAM}, nop_from = ${MOVE.to[0]}, nop_to = ${MOVE.to[1]}, month_from = ${mFrom}, month_to = ${mTo} where collection_id = ${MOVE.id}`;
    console.log(`   move OR ${MOVE.or} 2026-08-11 ₱${MOVE.amount} · ${MACAIRE.memberNumber} D-210 HG NOP ${MOVE.from.join("–")} → ${number} D-320 NOP ${MOVE.to.join("–")} (${mFrom} to ${mTo})`);
    for (const r of RENUMBER) {
      const month = monthOf(MACAIRE.doi, r.to);
      await tx`update collections set nop_from = ${r.to}, nop_to = ${r.to}, month_from = ${month}, month_to = ${month} where collection_id = ${r.id}`;
      console.log(`   ${MACAIRE.memberNumber} OR ${r.or} · NOP ${r.from} → ${r.to} (${month})`);
    }

    // 7. Reprice, 8. statuses.
    const finance = await repriceEntries((q, p) => tx.unsafe(q, p), { collectionIds: [MOVE.id, ...RENUMBER.map((r) => r.id)] });
    for (const c of finance.changes) console.log(`   reprice ${c.id}: company share ${c.before.remittance} → ${c.after.remittance}`);
    console.log(`   repricing: ${finance.changes.length} receipt(s) changed, incentive change ₱${finance.incentiveChange}, linked remittances changed: ${finance.slips.map((s) => `${s.id} (${s.expectedChange})`).join(", ") || "none"}`);
    const macaireStatus = await statusOf(tx, MACAIRE.enrollmentId), carlosStatus = await statusOf(tx, enrollmentId);
    console.log(`\nStatus: ${MACAIRE.memberNumber} ${macaire.account_status} → ${macaireStatus}; ${number} → ${carlosStatus}`);

    await tx`insert into record_corrections ${tx({ correction_id: `COR-SPLIT-${memberId}`, module: "Member split", record_id: MACAIRE.memberId,
      reason: "Maceda, Carlos (D-320, Pantukan) was never in the system; his payment OR 0592 T was entered under MACEDA MACAIRE (2026 workbook Adjustments 2026 row 969, Pañares, Nimfa, Aug 26, 2026, not ticked done). New member from the 2025 workbook (DDN - COL. rows 35, 2227, 7639, 13013), DOI Aug 1, 2024 from his NOPs; 0592 T moved to him as NOP 22-29; Macaire's later receipts renumbered 26-29 (owner, Nov 26, 2026).",
      before_json: { member: MACAIRE.memberId, account: MACAIRE.enrollmentId, status: macaire.account_status, moved: { id: MOVE.id, nop: MOVE.from }, renumbered: RENUMBER.map((r) => ({ id: r.id, nop: r.from })), sourceHash },
      after_json: { newMember: memberId, newMemberNumber: number, newAccount: enrollmentId, doi: CARLOS.doi, added: OLD.map((i) => ({ ref: i.ref, or: i.or })), moved: { id: MOVE.id, nop: MOVE.to }, renumbered: RENUMBER.map((r) => ({ id: r.id, nop: r.to })), status: macaireStatus, newStatus: carlosStatus, incentiveChange: finance.incentiveChange, slips: finance.slips },
      corrected_at: now, ...stamp })}`;
    if (!apply) throw new Rollback();
  });
  console.log(apply ? "\nApplied." : "\nDry run: nothing was saved. Add --apply to save.");
} catch (error) {
  if (error instanceof Rollback) console.log("\nDry run: nothing was saved. Add --apply to save.");
  else { console.error("FAILED:", error instanceof Error ? error.message : error); process.exitCode = 1; }
} finally {
  await sql.end();
}

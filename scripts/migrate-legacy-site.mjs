/**
 * Imports the old web app's (dayong.gissolve.com, May 2 – Oct 2026) members, New Sales and collections into the
 * database, from the export in legacy-data/export/ (scripts/legacy-site-export.mjs: lists plus every record's details).
 *
 *   node scripts/migrate-legacy-site.mjs                          dry run on staging (.env.local): counts only
 *   node scripts/migrate-legacy-site.mjs --apply                  write to staging
 *   npm run prod -- node scripts/migrate-legacy-site.mjs [--apply]   production (check the printed project ref)
 *
 * How records become ours (owner's rules for the old workbook, October 4, 2026, applied the same way):
 * - Members: one per person (same name and birthdate, or one birthdate blank). A person already in the database is
 *   matched by full name and a compatible birthdate and gets no new member; their new account is added to them.
 * - New Sales: one account (enrollment) and one sale each. DOI = the sale's OR date; an OR date before 2026 or blank
 *   (typed birthdates, missing dates) uses the Date Remitted. An account the member already has in the database
 *   (same program) is not imported again.
 * - Collections: linked to their sale by the old site's member and program IDs. NOPs come from the months paid and the
 *   DOI (the sale is NOP 1). An account that fails our rules as recorded (gaps, overlaps, a payment repeating the
 *   sale's month) is renumbered: payments in OR-date order, consecutive months from the month after the DOI, each
 *   covering the months its amount pays at the program rate. A payment that is not a whole number of monthly payments
 *   leaves the whole account out, listed for review.
 * - Programs are mapped by config/legacy-site-map.json; its drafts are added when missing (--apply).
 * - MAS: the config's "mas" entry, else the employee with that full name, or with that surname and first initial
 *   ("Surname, F." from the workbook). Run scripts/merge-employees.mjs first so one person is one employee. A MAS who
 *   is not an employee is registered with a temporary LEG-YYYY-NNNN ID (owner's decision October 8, 2026, as on
 *   October 4): role MAS, active, their branches, no sign-in; replace the ID in Employees → Edit later.
 * - Everything was remitted on the old site: remittance status Remitted, remittance = amount − the old incentive.
 * - Receipt and application numbers already in use are imported flagged legacy_duplicate (shown on Exceptions), as
 *   in the October workbook import. Application numbers never identify a record across systems.
 * IDs carry the old record ID (MEM-WEB-…, ENR-WEB-…, SALE-WEB-…, COL-WEB-…), so a re-run skips what is imported and
 * adds only what is new: new members and sales, and new payments on accounts imported earlier (checked with every
 * payment the account has now; a receipt already in the database is skipped).
 *
 * Privacy: prints counts, program codes and employee names only. Accounts left out are listed by old-site record ID
 * (open /new-sales/edit/{id} or /entries/edit/{id} there) in legacy-data/web-import-report-*.txt, which stays local.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import nextEnv from "@next/env";
import postgres from "postgres";
import { accountState, monthIndex, monthName, todayInManila } from "../lib/account-rules.ts";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const DIR = process.argv.find((arg) => arg.startsWith("--dir="))?.slice(6) ?? "legacy-data/export";
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
for (const file of ["members", "new_sales", "collections"]) if (!fs.existsSync(`${DIR}/${file}.csv`)) throw new Error(`Missing ${DIR}/${file}.csv: run scripts/legacy-site-export.mjs first.`);
const config = JSON.parse(fs.readFileSync("config/legacy-site-map.json", "utf8"));
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";
const today = todayInManila();
const SITE_START = "2026-01-01";
const IMPORTED_BY = "Old web app import";

// ---------------------------------------------------------------- reading the export
function readCsv(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === "\"") { if (text[i + 1] === "\"") { cell += "\""; i++; } else quoted = false; } else cell += c; }
    else if (c === "\"") quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  const [header, ...body] = rows;
  return body.map((values) => Object.fromEntries(header.map((name, index) => [name, (values[index] ?? "").trim()])));
}
const str = (value) => String(value ?? "").trim();
const words = (...parts) => parts.join(" ").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter((word) => word.length > 1);
const nameKey = (...parts) => [...new Set(words(...parts))].sort().join(" ");
const norm = (value) => str(value).toUpperCase().replace(/\s+/g, "");
const entryKey = (value) => str(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const validDate = (value) => { const time = Date.parse(`${value}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value; };
const blankish = (value) => (/^(N\/?A|NONE|-+)$/i.test(str(value)) ? "" : str(value));
const titleCase = (value) => str(value).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
const money = (value) => { const n = Number(str(value).replace(/[^0-9.-]/g, "")); return str(value) && Number.isFinite(n) ? n : NaN; };
/** "12345A" or "12345 a" → "12345 A" (our receipt style); anything else as written. */
const receipt = (value) => { const m = /^0*(\d+)\s*([A-Za-z]{1,2})$/.exec(str(value)); return m ? `${m[1]} ${m[2].toUpperCase()}` : str(value).toUpperCase(); };
const ageAt = (birthdate, date) => {
  if (!validDate(birthdate) || !validDate(date)) return null;
  const age = Number(date.slice(0, 4)) - Number(birthdate.slice(0, 4)) - (date.slice(5) < birthdate.slice(5) ? 1 : 0);
  return age >= 0 && age < 130 ? age : null;
};
const tally = new Map();
const count = (label, by = 1) => tally.set(label, (tally.get(label) ?? 0) + by);

const siteMembers = readCsv(`${DIR}/members.csv`), siteSales = readCsv(`${DIR}/new_sales.csv`), siteCollections = readCsv(`${DIR}/collections.csv`);
const withDetails = (rows, field) => rows.filter((row) => str(row[field]) || str(row[`form_${field}`])).length;
console.log(`Old web app export: ${siteMembers.length} members (${withDetails(siteMembers, "lname")} with details), ${siteSales.length} New Sales (${withDetails(siteSales, "member_id_value")} with details), ${siteCollections.length} collections (${withDetails(siteCollections, "member_id_value")} with details).`);

// ---------------------------------------------------------------- the database
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  const [programs, branches, employees, dbMembers, dbEnrollments, dbCollections, dbSales, imported] = await Promise.all([
    sql`select program_id, program_code, program_name, base_pay::float as base_pay, pay_balance_total::float as pay_balance_total, flexible, max_monthly_payment::float as max_monthly_payment from programs`,
    sql`select branch_id, branch_name_code from branches`,
    sql`select employee_id, full_name from employees`,
    sql`select member_id, member_number, first_name, middle_name, surname, name_extension, birthdate::text as birthdate from members`,
    sql`select enrollment_id, member_id, program_id from member_programs`,
    sql`select or_key, or_date::text as or_date, status, legacy_duplicate from collections where coalesce(or_key, '') <> ''`,
    sql`select application_key from sales where coalesce(application_key, '') <> '' and not legacy_duplicate`,
    sql`select member_id as id from members where member_id like '%-WEB-%' union all select enrollment_id from member_programs where enrollment_id like '%-WEB-%'
        union all select sale_id from sales where sale_id like '%-WEB-%' union all select collection_id from collections where collection_id like '%-WEB-%'`,
  ]);
  console.log(`Database: Supabase project ${project} · ${dbMembers.length} members, ${dbEnrollments.length} accounts.${apply ? "" : " Dry run: nothing is written."}\n`);
  const done = new Set(imported.map((row) => row.id));

  // Programs: config map → our program by code or name; missing drafts get the next DP-#### on --apply.
  let nextProgram = Math.max(0, ...programs.map((p) => Number(/^DP-(\d+)$/.exec(p.program_id)?.[1]) || 0)) + 1;
  const draftsToAdd = [];
  const programMap = new Map(Object.entries(config.map).map(([site, ours]) => [norm(site), norm(ours)]));
  const programCache = new Map();
  function programFor(siteCode) {
    const key = norm(siteCode);
    if (programCache.has(key)) return programCache.get(key);
    const target = programMap.get(key) ?? key;
    let found = programs.find((p) => norm(p.program_code) === target || norm(p.program_name) === target);
    if (found) found = { id: found.program_id, code: found.program_name, basePay: found.base_pay, payBalanceTotal: found.pay_balance_total ?? 0, flexible: found.flexible, max: found.max_monthly_payment };
    else {
      const draft = config.drafts.find((d) => norm(d.code) === target);
      if (draft) { found = { id: `DP-${String(nextProgram++).padStart(4, "0")}`, code: draft.code, basePay: draft.base_pay, payBalanceTotal: draft.pay_balance_total ?? 0, flexible: false, max: null, draft }; draftsToAdd.push(found); }
    }
    programCache.set(key, found ?? null);
    return found ?? null;
  }
  const branchFor = (name) => branches.find((b) => norm(b.branch_name_code) === norm(name))?.branch_name_code ?? null;

  // MAS: same full name, else the employee whose surname is in the old name and whose first name starts it.
  const masCache = new Map();
  function masFor(name) {
    const key = nameKey(name);
    if (!key) return null;
    if (masCache.has(key)) return masCache.get(key);
    const site = words(name);
    const pinned = Object.entries(config.mas ?? {}).find(([written]) => nameKey(written) === key)?.[1];
    let hits = pinned ? employees.filter((e) => e.employee_id === pinned) : employees.filter((e) => nameKey(e.full_name) === key);
    if (!hits.length && !pinned) hits = employees.filter((e) => {
      const [surnamePart, givenPart] = e.full_name.includes(",") ? e.full_name.split(",") : [e.full_name.trim().split(/\s+/).at(-1), e.full_name.trim().split(/\s+/).slice(0, -1).join(" ")];
      const surname = words(surnamePart), given = words(givenPart)[0] ?? str(givenPart).replace(/[^A-Za-z]/g, "");
      if (!surname.length || !surname.every((w) => site.includes(w)) || !given) return false;
      // "Ma." is short for Maria: a given name of up to 3 letters may start a longer one.
      if (given.length === 1) return site[0]?.startsWith(given.toUpperCase());
      return site.some((w) => w === given || (given.length <= 3 && w.startsWith(given)));
    });
    const found = hits.length === 1 ? { id: hits[0].employee_id, name: hits[0].full_name } : null;
    masCache.set(key, found);
    return found;
  }

  // ---------------------------------------------------------------- members
  const dbByName = new Map();
  for (const m of dbMembers) { const key = nameKey(m.first_name, m.middle_name, m.surname, m.name_extension); (dbByName.get(key) ?? dbByName.set(key, []).get(key)).push(m); }
  const usedNumbers = new Set(dbMembers.map((m) => m.member_number));
  const memberNumberFor = (memberId) => {
    let n = parseInt(createHash("sha1").update(memberId).digest("hex").slice(0, 12), 16) % 100_000_000;
    while (usedNumbers.has(`PH-${String(n).padStart(8, "0")}`)) n = (n + 1) % 100_000_000;
    const number = `PH-${String(n).padStart(8, "0")}`;
    usedNumbers.add(number);
    return number;
  };
  /** Old member record ID → our member (existing or new). Several old records of one person share one member. */
  const memberOf = new Map(), people = new Map(), newMembers = [];
  for (const row of siteMembers) {
    if (!str(row.lname) && !str(row.fname)) { count("Members: details not exported yet (run the export again)"); continue; }
    const person = {
      surname: str(row.lname), firstName: str(row.fname), middleName: blankish(row.mname), ext: blankish(row.ext),
      birthdate: validDate(str(row.birthdate)) ? str(row.birthdate) : "",
    };
    const key = nameKey(person.firstName, person.middleName, person.surname, person.ext);
    const compatible = (birthdate) => !birthdate || !person.birthdate || birthdate === person.birthdate;
    const sameSite = (people.get(key) ?? []).find((p) => compatible(p.birthdate));
    if (sameSite) { memberOf.set(row.record_id, sameSite.member); count("Members: same person as another old record (merged)"); continue; }
    const inDb = (dbByName.get(key) ?? []).filter((m) => compatible(m.birthdate ?? ""));
    let member;
    if (inDb.length === 1) { member = { id: inDb[0].member_id, number: inDb[0].member_number, existing: true }; count("Members: already in the database (new accounts are added to them)"); }
    else if (inDb.length > 1) { count("Members: left out, name matches several members in the database"); memberOf.set(row.record_id, null); continue; }
    else {
      const id = `MEM-WEB-${row.record_id}`;
      member = { id, existing: done.has(id), number: dbMembers.find((m) => m.member_id === id)?.member_number, row, person };
      if (!member.existing) newMembers.push(member);
    }
    memberOf.set(row.record_id, member);
    (people.get(key) ?? people.set(key, []).get(key)).push({ birthdate: person.birthdate, member });
  }
  const membersByName = new Map();
  for (const row of siteMembers) { const key = nameKey(row["Full Name"]); (membersByName.get(key) ?? membersByName.set(key, []).get(key)).push(row.record_id); }

  // ---------------------------------------------------------------- New Sales → accounts
  const held = [];
  const hold = (kind, id, reason) => { held.push({ kind, id, reason }); count(`Left out: ${reason}`); };
  const dbAccounts = new Set(dbEnrollments.map((e) => `${e.member_id}|${e.program_id}`));
  const accounts = new Map(), accountByMemberProgram = new Map(), saleBySiteKey = new Map();
  for (const row of siteSales) {
    const siteMemberId = str(row.member_id_value) || ((ids) => (ids?.length === 1 ? ids[0] : ""))(membersByName.get(nameKey(row["Full Name"])));
    const member = memberOf.get(siteMemberId);
    const program = programFor(row.Program), branch = branchFor(row.Branch);
    if (!member) { hold("New Sale", row.record_id, siteMemberId ? "member left out or not exported" : "member not found on the old site"); continue; }
    if (!program) { hold("New Sale", row.record_id, `program ${row.Program} is not mapped (config/legacy-site-map.json)`); continue; }
    if (!branch) { hold("New Sale", row.record_id, `branch ${row.Branch} not found`); continue; }
    const orDate = str(row["OR Date"]), remitted = str(row["Date Remitted"]);
    const doi = validDate(orDate) && orDate >= SITE_START && orDate <= today ? orDate : validDate(remitted) ? remitted : "";
    if (!doi) { hold("New Sale", row.record_id, "no usable OR date or date remitted"); continue; }
    if (doi !== orDate) count("Repaired: DOI taken from the date remitted (OR date blank or before 2026)");
    const pair = `${member.id}|${program.id}`;
    const id = `ENR-WEB-${row.record_id}`;
    if (!done.has(id) && dbAccounts.has(pair)) { hold("New Sale", row.record_id, "the member already has this program in the database"); continue; }
    if (accountByMemberProgram.has(pair)) { hold("New Sale", row.record_id, "a second New Sale of the same program for one member"); continue; }
    const account = { id, saleId: `SALE-WEB-${row.record_id}`, row, member, program, branch, mas: masFor(row.MAS), masName: str(row.MAS), doi, payments: [], done: done.has(id) };
    accounts.set(id, account); accountByMemberProgram.set(pair, account);
    saleBySiteKey.set(`${siteMemberId}|${str(row.program_id_value)}`, account);
  }

  // ---------------------------------------------------------------- collections
  const salesByProgram = new Map();
  for (const a of accounts.values()) { const key = norm(a.row.Program); (salesByProgram.get(key) ?? salesByProgram.set(key, []).get(key)).push(a); }
  const receiptsInDb = new Set(dbCollections.map((c) => `${c.or_key}|${c.or_date}`));
  for (const row of siteCollections) {
    let account = saleBySiteKey.get(`${str(row.member_id_value)}|${str(row.program_id_value)}`);
    if (!account) {
      // Without details: the payer's name words all in the sale's full name, same program; the branch breaks a tie.
      const payer = words(row.Member);
      let hits = (salesByProgram.get(norm(row.Program)) ?? []).filter((a) => payer.length && payer.every((w) => words(a.row["Full Name"]).includes(w)));
      if (hits.length > 1) hits = hits.filter((a) => a.row.Branch === row.Branch);
      account = hits.length === 1 ? hits[0] : undefined;
    }
    if (!account) { hold("Collection", row.record_id, "its New Sale is not imported"); continue; }
    const amount = money(row.Amount), monthFrom = str(row["Month From"]), monthTo = str(row["Month To"]);
    const orDate = validDate(str(row["OR Date"])) ? str(row["OR Date"]) : str(row["Created At"]).slice(0, 10);
    account.payments.push({
      id: `COL-WEB-${row.record_id}`, enrollmentId: account.id, orDate, orNumber: receipt(row.OR), amount, monthFrom, monthTo,
      nopFrom: monthIndex(monthFrom) - monthIndex(account.doi.slice(0, 7)) + 1, nopTo: monthIndex(monthTo) - monthIndex(account.doi.slice(0, 7)) + 1,
      dateRemitted: str(row["Created At"]).slice(0, 10), mas: str(row.Agent), row,
      incentive: money(row.data_incentives), inDb: receiptsInDb.has(`${entryKey(row.OR)}|${orDate}`),
    });
  }

  // ---------------------------------------------------------------- our account rules
  const asAccount = (a) => ({ id: a.id, memberId: a.member.id, memberNumber: "", programId: a.program.id, doi: a.doi, branch: a.branch, mas: a.masName, basePay: a.program.basePay, payBalanceTotal: a.program.payBalanceTotal, storedStatus: "", flexible: a.program.flexible, maxMonthlyPayment: a.program.max });
  /** Renumbers every payment in OR-date order from the month after the DOI; null when an amount is not whole months. */
  function renumber(a) {
    const rate = a.program.basePay;
    let next = monthIndex(a.doi.slice(0, 7)) + 1;
    const sorted = [...a.payments].sort((x, y) => x.orDate.localeCompare(y.orDate) || Number(x.row.record_id) - Number(y.row.record_id));
    const result = [];
    for (const p of sorted) {
      const written = monthIndex(p.monthTo) - monthIndex(p.monthFrom) + 1;
      const months = a.program.flexible ? (written >= 1 && p.amount >= rate * written ? written : Math.floor(p.amount / rate)) : p.amount / rate;
      if (!Number.isInteger(months) || months < 1) return null;
      const doiIndex = monthIndex(a.doi.slice(0, 7));
      result.push({ ...p, monthFrom: monthName(next), monthTo: monthName(next + months - 1), nopFrom: next - doiIndex + 1, nopTo: next + months - doiIndex });
      next += months;
    }
    return result;
  }
  const statuses = new Map();
  for (const a of accounts.values()) {
    if (a.done) { count("Accounts: already imported by an earlier run"); continue; }
    if (a.payments.some((p) => p.inDb)) { a.held = true; hold("New Sale", a.row.record_id, "some of its receipts (OR number and date) are already in the database"); continue; }
    if (a.payments.some((p) => !Number.isFinite(p.amount) || p.amount <= 0 || !/^\d{4}-\d{2}$/.test(p.monthFrom) || !/^\d{4}-\d{2}$/.test(p.monthTo))) { a.held = true; hold("New Sale", a.row.record_id, "a collection has an unreadable amount or month"); continue; }
    let state;
    try { state = accountState(asAccount(a), a.payments, today); }
    catch {
      const renumbered = renumber(a);
      if (!renumbered) { a.held = true; hold("New Sale", a.row.record_id, "a payment is not a whole number of monthly payments"); continue; }
      try { state = accountState(asAccount(a), renumbered, today); a.payments = renumbered; count("Repaired: payments renumbered in OR-date order"); }
      catch (error) { a.held = true; hold("New Sale", a.row.record_id, `fails our account rules (${error.message.replace(/^(Payment|Account) \S+ /, "")})`); continue; }
    }
    a.status = state.status;
    statuses.set(state.status, (statuses.get(state.status) ?? 0) + 1);
  }
  for (const a of accounts.values()) if (a.held) for (const p of a.payments) hold("Collection", p.row.record_id, "its account is left out");

  // Accounts imported by an earlier run: payments added on the old site since then are checked together with every
  // payment the account has now (imported, or encoded in this system since) and added after them.
  const topUps = [...accounts.values()].filter((a) => a.done && a.payments.some((p) => !done.has(p.id)));
  const stored = topUps.length ? await sql`select collection_id as id, enrollment_id as "enrollmentId", or_date::text as "orDate", or_number as "orNumber", month_from as "monthFrom",
    month_to as "monthTo", nop_from as "nopFrom", nop_to as "nopTo", amount_collected::float as amount, coalesce(date_remitted::text, '') as "dateRemitted", mas
    from collections where status = 'Posted' and enrollment_id in ${sql(topUps.map((a) => a.id))}` : [];
  for (const a of topUps) {
    const existing = stored.filter((p) => p.enrollmentId === a.id);
    const fresh = a.payments.filter((p) => !done.has(p.id));
    const skipped = fresh.filter((p) => p.inDb).length;
    if (skipped) count("Collections: already in the database (same OR number and date), skipped", skipped);
    let added = fresh.filter((p) => !p.inDb).sort((x, y) => x.orDate.localeCompare(y.orDate) || Number(x.row.record_id) - Number(y.row.record_id));
    a.payments = [];
    if (!added.length) continue;
    let state;
    try { state = accountState(asAccount(a), [...existing, ...added], today); }
    catch {
      // As with a new account: the new payments follow the last month already covered, each covering what its amount pays.
      const rate = a.program.basePay, doiIndex = monthIndex(a.doi.slice(0, 7));
      let next = Math.max(doiIndex, ...existing.map((p) => monthIndex(p.monthTo))) + 1;
      const renumbered = [];
      for (const p of added) {
        const written = monthIndex(p.monthTo) - monthIndex(p.monthFrom) + 1;
        const months = a.program.flexible ? (written >= 1 && p.amount >= rate * written ? written : Math.floor(p.amount / rate)) : p.amount / rate;
        if (!Number.isInteger(months) || months < 1) { renumbered.length = 0; break; }
        renumbered.push({ ...p, monthFrom: monthName(next), monthTo: monthName(next + months - 1), nopFrom: next - doiIndex + 1, nopTo: next + months - doiIndex });
        next += months;
      }
      try { if (!renumbered.length) throw new Error("not whole months"); state = accountState(asAccount(a), [...existing, ...renumbered], today); added = renumbered; count("Repaired: new payments on an imported account renumbered"); }
      catch { for (const p of added) hold("Collection", p.row.record_id, "a new payment on an imported account does not fit its history"); continue; }
    }
    a.payments = added; a.status = state.status; a.topUp = true;
    count("Collections: new on accounts imported earlier", added.length);
  }

  // ---------------------------------------------------------------- MAS who are not employees yet
  // Registered like the October 4 workbook MAS (scripts/register-legacy-mas.mjs): a temporary LEG-YYYY-NNNN ID, role MAS,
  // active, every branch where they sold or collected (primary = the most records), no sign-in. Spellings of one person
  // (same first name and surname, with or without the middle name) become one employee, named by the fullest spelling.
  const NOT_PEOPLE = /^(others|dto|none)$|-dto$/i;
  const used = new Map();
  for (const a of accounts.values()) {
    if (a.held || (a.done && !a.topUp)) continue;
    for (const [name, branch] of [[a.masName, a.branch], ...a.payments.map((p) => [p.mas, a.branch])]) {
      if (!str(name) || NOT_PEOPLE.test(str(name)) || masFor(name)) continue;
      const w = words(name), key = `${w[0]} ${w.at(-1)}`;
      const group = used.get(key) ?? used.set(key, { names: new Set(), branches: new Map(), records: 0 }).get(key);
      group.names.add(str(name)); group.records++; group.branches.set(branch, (group.branches.get(branch) ?? 0) + 1);
    }
  }
  const year = today.slice(0, 4), legNumber = new RegExp(`^LEG-${year}-(\\d+)$`);
  let nextLeg = Math.max(0, ...employees.map((e) => Number(legNumber.exec(e.employee_id)?.[1]) || 0)) + 1;
  const registrations = [...used.values()].sort((x, y) => y.records - x.records).map((group) => {
    const written = [...group.names].sort((x, y) => words(y).length - words(x).length || y.length - x.length)[0];
    const employee = { id: `LEG-${year}-${String(nextLeg++).padStart(4, "0")}`, name: titleCase(written), records: group.records, names: group.names,
      branches: [...group.branches].sort((x, y) => y[1] - x[1]).map(([branch]) => branch) };
    for (const name of group.names) masCache.set(nameKey(name), { id: employee.id, name: employee.name });
    return employee;
  });
  for (const a of accounts.values()) if (!a.mas) a.mas = masFor(a.masName);

  // ---------------------------------------------------------------- rows
  const ready = [...accounts.values()].filter((a) => !a.held && !a.done);
  const toppedUp = [...accounts.values()].filter((a) => a.topUp);
  const neededMembers = new Set(ready.map((a) => a.member.id));
  const membersToAdd = newMembers.filter((m) => neededMembers.has(m.id));
  const firstDoi = new Map();
  for (const a of ready) if (!firstDoi.has(a.member.id) || a.doi < firstDoi.get(a.member.id)) firstDoi.set(a.member.id, a.doi);
  for (const m of membersToAdd) m.number = memberNumberFor(m.id);
  const memberDetails = (m) => {
    const r = m.row, p = m.person;
    return {
      surname: p.surname, first_name: p.firstName, middle_name: p.middleName || null, name_extension: p.ext || null, birthdate: p.birthdate || null,
      birthplace: str(r.birthplace) || null, gender: titleCase(r.sex) || null, age: ageAt(p.birthdate, firstDoi.get(m.id)), civil_status: titleCase(r.civil_status) || null,
      member_contact: str(r.contact_num) || str(r["Contact No"]) || null, address: str(r.address) || str(r.Address) || null,
      claimant_name: [r.fname_c, r.mname_c, r.lname_c, blankish(r.ext_c)].map(str).filter(Boolean).join(" ") || null,
      claimant_contact: str(r.contact_num_c) || null, claimant_same_address: false, claimant_address: null,
    };
  };
  const identity = { encoded_by_user_id: null, encoded_by_employee_id: null, encoded_by_name: IMPORTED_BY, encoded_at: new Date().toISOString() };
  const usedApplications = new Set(dbSales.map((s) => s.application_key));
  const usedReceipts = new Set(dbCollections.filter((c) => c.status === "Posted" && !c.legacy_duplicate).map((c) => c.or_key));
  const flagged = (key, used) => { if (!key) return false; const duplicate = used.has(key); used.add(key); return duplicate; };
  const stamp = (date) => `${date}T00:00:00+08:00`;
  const memberRows = membersToAdd.map((m) => ({ member_id: m.id, member_number: m.number, ...memberDetails(m), status: /DECEASED/i.test(m.row.Status) ? "Deceased" : "Active", ...identity }));
  const numberOf = (member) => member.number ?? membersToAdd.find((m) => m.id === member.id)?.number;
  const enrollmentRows = [], saleRows = [], collectionRows = [];
  for (const a of ready) {
    const r = a.row, amount = money(r.data_amount || r.amount), incentive = money(r.data_incentives || r.incentives), registration = money(r.registration_fee);
    const created = validDate(str(r["Created At"]).slice(0, 10)) ? stamp(str(r["Created At"]).slice(0, 10)) : stamp(a.doi);
    const mas = a.mas?.name ?? a.masName;
    enrollmentRows.push({ enrollment_id: a.id, member_id: a.member.id, member_number: numberOf(a.member), program_id: a.program.id, doi: a.doi, branch: a.branch, mas,
      remittance_method: "Cash", registration_fee: registration > 0, registration_amount: registration > 0 ? registration : null, amount_paid: Number.isFinite(amount) ? amount : null,
      program_terms: null, status: "Active", date_created: created, ...identity, account_status: a.status });
    const details = a.member.existing ? null : memberDetails(a.member);
    const remitted = str(r["Date Remitted"]);
    saleRows.push({ sale_id: a.saleId, date_created: created, branch: a.branch, mas, date_remitted: validDate(remitted) ? remitted : a.doi, member_number: numberOf(a.member),
      ...(details ?? await existingDetails(a.member.id)), program_id: a.program.id, doi: a.doi, payment_method: "Cash", registration_fee: registration > 0,
      registration_amount: registration > 0 ? registration : null, amount_paid: Number.isFinite(amount) ? amount : null, notes: str(r.remarks) || null,
      application_no: str(r["App No"]) || str(r.app_no) || null, or_number: str(r["OR #"]) || str(r.or_number) ? receipt(str(r["OR #"]) || str(r.or_number)) : null, or_date: a.doi,
      ...identity, remittance_status: "Remitted", accountable_employee_id: a.mas?.id ?? null, mas_incentive: Number.isFinite(incentive) ? incentive : null,
      remittance_amount: Number.isFinite(amount) ? Math.max(0, amount - (Number.isFinite(incentive) ? incentive : 0)) : null,
      legacy_duplicate: flagged(entryKey(str(r["App No"]) || str(r.app_no)), usedApplications) });
    collectionRows.push(...collectionsOf(a));
  }
  for (const a of toppedUp) collectionRows.push(...collectionsOf(a));
  function collectionsOf(a) {
    return a.payments.map((p) => {
      const collector = str(p.row.collector_id_value);
      const payMas = masFor(p.mas)?.name ?? p.mas;
      return { collection_id: p.id, collection_batch_id: `CBT-WEB-${a.branch.replace(/[^A-Z0-9]+/gi, "")}-${p.dateRemitted}`, enrollment_id: a.id, member_id: a.member.id,
        member_number: numberOf(a.member), program_id: a.program.id, branch: a.branch, mas: payMas, or_number: p.orNumber, or_date: p.orDate, amount_collected: p.amount,
        month_from: p.monthFrom, month_to: p.monthTo, nop_from: p.nopFrom, nop_to: p.nopTo, reactivation: false, transferred: false, suspended: null, original_mas: null,
        status: "Posted", created_at: validDate(p.dateRemitted) ? stamp(p.dateRemitted) : stamp(p.orDate), ...identity, collected_by_role: collector ? "Collector" : "MAS",
        remittance_amount: Math.max(0, p.amount - (Number.isFinite(p.incentive) ? p.incentive : 0)), remittance_status: "Remitted", accountable_employee_id: masFor(p.mas)?.id ?? null,
        accountable_name: payMas, accountable_role: "MAS", remittance_method: "Cash", date_remitted: validDate(p.dateRemitted) ? p.dateRemitted : p.orDate,
        legacy_duplicate: flagged(entryKey(p.orNumber), usedReceipts) };
    });
  }
  /** The member's details as recorded, copied onto a New Sale for a member already in the database. */
  async function existingDetails(memberId) {
    const [m] = await sql`select surname, first_name, middle_name, name_extension, birthdate::text as birthdate, birthplace, gender, age, civil_status, member_contact, address,
      claimant_name, claimant_contact, claimant_same_address, claimant_address from members where member_id = ${memberId}`;
    return m;
  }

  // ---------------------------------------------------------------- report
  console.log("Programs:");
  for (const [site, program] of programCache) console.log(`  ${site} → ${program ? `${program.code} (${program.id}, ₱${program.basePay}/month)${program.draft ? " · NEW DRAFT" : ""}` : "not mapped"}`);
  console.log(`\nTo import: ${memberRows.length} new members, ${enrollmentRows.length} accounts with their New Sales (${ready.filter((a) => a.member.existing).length} for members already in the database), ${collectionRows.length} collections.`);
  // Which programs the new accounts go to, so a new draft program is noticed before --apply.
  if (ready.length) {
    const perProgram = new Map();
    for (const a of ready) { const label = `${a.program.code} (${a.program.id}${a.program.draft ? ", NEW DRAFT" : ""})`; perProgram.set(label, (perProgram.get(label) ?? 0) + 1); }
    console.log(`New accounts by program: ${[...perProgram].map(([label, count]) => `${label} ${count}`).join(" · ")}`);
  }
  console.log(`Account statuses: ${[...statuses].sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s} ${n}`).join(" · ") || "none"}`);
  const dupSales = saleRows.filter((r) => r.legacy_duplicate).length, dupCollections = collectionRows.filter((r) => r.legacy_duplicate).length;
  if (dupSales || dupCollections) console.log(`Flagged as duplicates (number already used): ${dupSales} application numbers, ${dupCollections} OR numbers.`);
  console.log(`New Sales without an OR number: ${saleRows.filter((r) => !r.or_number).length}. Collections OR numbers without a branch letter: ${collectionRows.filter((r) => /^\d+$/.test(r.or_number)).length}.`);
  console.log("\nCounts:");
  for (const [label, n] of [...tally].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${String(n).padStart(5)} × ${label}`);
  if (registrations.length) {
    console.log(`\nMAS to register in Employees (not employees yet; temporary IDs, no sign-in; if one is an employee already, pin the name under "mas" in config/legacy-site-map.json instead):`);
    for (const r of registrations) console.log(`  ${r.id}  ${r.name}  · ${r.records} record(s) · ${r.branches.join(", ")}${r.names.size > 1 ? ` · also written ${[...r.names].filter((n) => titleCase(n) !== r.name).join(" / ")}` : ""}`);
  }
  const reportFile = `legacy-data/web-import-report-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
  fs.writeFileSync(reportFile, [`Old web app import, ${project}, ${apply ? "applied" : "dry run"}. Records left out, by old-site record ID (New Sale: /new-sales/edit/ID, Collection: /entries/edit/ID).`, "",
    ...held.map((h) => `${h.kind}\t${h.id}\t${h.reason}`)].join("\r\n"));
  console.log(`\nRecords left out, by old-site record ID: ${reportFile}`);

  if (!apply) { console.log("\nDry run. Nothing was written. Add --apply to import."); process.exit(0); }

  // ---------------------------------------------------------------- write (one transaction: all or nothing)
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', ${IMPORTED_BY}, true)`;
    const used = new Set(ready.map((a) => a.program.id));
    const drafts = draftsToAdd.filter((p) => used.has(p.id));
    const branchId = new Map(branches.map((b) => [b.branch_name_code, b.branch_id]));
    for (const r of registrations) {
      await tx`insert into employees ${tx({ employee_id: r.id, full_name: r.name, primary_branch: r.branches[0] ?? null, operational_roles: "MAS", employment_status: "active", created_at: identity.encoded_at, ...identity })}`;
      const assignments = r.branches.filter((b) => branchId.has(b)).map((b, i) => ({ assignment_id: `EBA-${r.id}-${String(i + 1).padStart(2, "0")}`, employee_id: r.id, branch_id: branchId.get(b), ...identity }));
      if (assignments.length) await tx`insert into employee_branches ${tx(assignments)}`;
    }
    for (const p of drafts) await tx`insert into programs ${tx({ program_id: p.id, program_code: p.code, program_name: p.code, base_pay: p.basePay, status: "active", description: p.draft.description, pay_balance_total: p.payBalanceTotal, ...identity })}`;
    const insert = async (table, rows) => { for (let i = 0; i < rows.length; i += 500) await tx`insert into ${tx(table)} ${tx(rows.slice(i, i + 500))}`; };
    await insert("members", memberRows);
    await insert("member_programs", enrollmentRows);
    await insert("sales", saleRows);
    await insert("collections", collectionRows);
    for (const a of toppedUp) await tx`update member_programs set account_status = ${a.status} where enrollment_id = ${a.id}`;
    console.log(`\nWritten: ${registrations.length} MAS registered, ${drafts.length} draft programs, ${memberRows.length} members, ${enrollmentRows.length} accounts, ${saleRows.length} New Sales, ${collectionRows.length} collections.`);
  });
} finally {
  await sql.end();
}

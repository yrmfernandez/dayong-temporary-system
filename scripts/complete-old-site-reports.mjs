/**
 * Completes the Entry Clerks' monthly reports for the days the old web app was still used (owner, October 29, 2026:
 * the system started around the 2nd week of October, so the October monthly reports miss the first days).
 *
 * The report counts what each clerk encoded, by the day encoded (lib/clerk-report.ts). The old-site records of the month
 * were imported on October 8-10 without a clerk, and its expenses and bank remittances were never imported. From the
 * export in legacy-data/export (scripts/legacy-site-export.mjs) this script, for records created in the month:
 *   - New Sales (SALE-WEB-…): the clerk is the old-site Encoder of the member registered with it the same day;
 *     otherwise the branch's clerk (below). Encoded on the old-site day created.
 *   - Collections (COL-WEB-…): the old site kept no encoder, so the branch's clerk (owner): the one Entry Clerk assigned
 *     to that branch today, when that clerk has no other branch; any other branch is listed for the owner to choose in
 *     config/old-site-report-clerks.json "branches". Encoded on the old-site day created.
 *   - Expenses (EXP-WEB-…) and bank / GCash remittances (DEP-WEB-…): added under their Encoded By clerk on their old-site
 *     date, except the expense types in "skipExpenseTypes" (counted already, such as MAS incentives).
 *   - The old sheet (config "oldSheet"): its New Sales and Collections imported as …-LEG-… that were created in the month
 *     (sheet Timestamp) and have no clerk go to the branch's clerk on that day; its Expenses Entry rows of the month are
 *     added as EXP-LEG-<row> under the branch's clerk. The sheet has no encoder column.
 * An entry that already has an encoder is never changed; a re-run skips what is done. Old-site names are matched to
 * employees by their name words; any that do not match are listed for "encoders". Prints staff names, branches,
 * counts and totals only (no member data).
 *
 *   node scripts/complete-old-site-reports.mjs                        dry run, staging
 *   npm run prod -- node scripts/complete-old-site-reports.mjs        dry run, production
 *   … --apply                                                         write (refused while anything is unresolved)
 *   … --dir=legacy-data/export                                        another export folder
 *   … --apply --rollback                                              test the writes of what is resolved, then undo them
 */
import fs from "node:fs";
import path from "node:path";
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ROLLBACK = args.includes("--rollback");
const DIR = args.find((arg) => arg.startsWith("--dir="))?.slice(6) || "legacy-data/export";
const CONFIG_FILE = "config/old-site-report-clerks.json";
const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
const MONTH = config.month;
const FROM = `${MONTH}-01`, TO = new Date(Date.UTC(Number(MONTH.slice(0, 4)), Number(MONTH.slice(5, 7)), 0)).toISOString().slice(0, 10);
const BY = "Old records report completion";
const OLD_SHEET = config.oldSheet ?? "legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx";

const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, idle_timeout: 0, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";

const str = (value) => String(value ?? "").trim();
const key = (value) => str(value).toLowerCase().replace(/\s+/g, " ");
// Name words without accents (Pañares = Panares); a hyphenated name counts as its parts and as one word (Rye-el = Rye El = Ryeel).
const words = (value) => key(value).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z\- ]/g, " ").split(" ")
  .flatMap((word) => word.includes("-") ? [...word.split("-"), word.replace(/-/g, "")] : [word]).filter((word) => word.length > 1);
const amount = (value) => Math.round((Number(str(value).replace(/[^0-9.-]/g, "")) || 0) * 100) / 100;
const day = (value) => /^\d{4}-\d{2}-\d{2}/.test(str(value)) ? str(value).slice(0, 10) : "";
const inMonth = (value) => { const d = day(value); return d >= FROM && d <= TO; };
// Noon in Manila on the old-site day, so the report places it on that day.
const noon = (date) => `${date}T04:00:00.000Z`;
const peso = (value) => `₱${value.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function readCsv(file) {
  const text = fs.readFileSync(path.join(DIR, file), "utf8").replace(/^﻿/, "");
  const rows = []; let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

try {
  console.log(`Database ${ref} · ${APPLY ? "APPLY" : "dry run"} · records created on the old site ${FROM} to ${TO} · export ${DIR}`);
  const [employees, clerkBranches, branches, users] = await Promise.all([
    sql`select employee_id, full_name, coalesce(employment_status, '') as status from employees`,
    sql`select e.employee_id, e.full_name, b.branch_name_code as branch from employees e join employee_branches eb on eb.employee_id = e.employee_id join branches b on b.branch_id = eb.branch_id
      where lower(coalesce(e.employment_status, 'active')) = 'active'
        and (lower(coalesce(e.operational_roles, '')) like '%entry clerk%' or exists (select 1 from users u join user_roles ur on ur.user_id = u.user_id join roles r on r.role_id = ur.role_id where u.employee_id = e.employee_id and lower(r.role_name) = 'entry clerk'))`,
    sql`select branch_name_code as name from branches`,
    sql`select user_id, employee_id from users where employee_id is not null`,
  ]);
  const employeeById = new Map(employees.map((row) => [row.employee_id, row]));
  const userOf = new Map(users.map((row) => [row.employee_id, row.user_id]));
  const branchName = new Map(branches.map((row) => [key(row.name), row.name]));

  // An old-site name → an employee: from the config, else the one active employee all of whose name words are in it (or it in theirs).
  const unmatched = new Map();
  const employeeFor = (name) => {
    const configured = config.encoders?.[str(name)] ?? config.encoders?.[str(name).toUpperCase()];
    if (configured) return employeeById.get(configured) ?? null;
    const site = new Set(words(name));
    if (!site.size) return null;
    const all = employees.filter((row) => row.status.toLowerCase() !== "resigned" && (() => { const own = words(row.full_name); return own.length > 1 && (own.every((word) => site.has(word)) || [...site].every((word) => own.includes(word))); })());
    // The clerk's own record before a temporary LEG-… MAS record registered from the imports under the same name.
    const clerks = all.filter((row) => branchesOf.has(row.employee_id)), real = all.filter((row) => !row.employee_id.startsWith("LEG-"));
    const fits = clerks.length ? clerks : real.length ? real : all;
    if (fits.length === 1) return fits[0];
    unmatched.set(str(name), fits.map((row) => `${row.employee_id} ${row.full_name}`));
    return null;
  };

  // The branch's clerk: chosen by the owner, else the only Entry Clerk on it today when that clerk has no other branch.
  const clerksOf = new Map(), branchesOf = new Map();
  for (const row of clerkBranches) {
    clerksOf.set(key(row.branch), [...(clerksOf.get(key(row.branch)) ?? []), row]);
    branchesOf.set(row.employee_id, [...(branchesOf.get(row.employee_id) ?? []), row.branch]);
  }
  const askOwner = new Map();
  const branchClerk = (branch) => {
    const chosen = Object.entries(config.branches ?? {}).find(([name]) => key(name) === key(branch))?.[1];
    if (chosen) return employeeById.get(chosen) ?? null;
    const clerks = clerksOf.get(key(branch)) ?? [];
    if (clerks.length === 1 && (branchesOf.get(clerks[0].employee_id) ?? []).length === 1) return employeeById.get(clerks[0].employee_id);
    askOwner.set(str(branch), clerks.map((row) => `${row.employee_id} ${row.full_name} (branches: ${(branchesOf.get(row.employee_id) ?? []).join(", ")})`));
    return null;
  };

  const members = new Map(readCsv("members.csv").map((row) => [str(row.record_id), row]));
  const siteSales = readCsv("new_sales.csv").filter((row) => inMonth(row.data_created_at || row["Created At"]));
  const siteCollections = readCsv("collections.csv").filter((row) => inMonth(row.data_created_at || row["Created At"]));
  const skip = new Set((config.skipExpenseTypes ?? []).map(key));
  const siteExpenses = readCsv("expenses_expense.csv").filter((row) => inMonth(row.Date));
  const siteDeposits = readCsv("expenses_remittance.csv").filter((row) => inMonth(row.Date));

  const saleIds = siteSales.map((row) => `SALE-WEB-${row.record_id}`), collectionIds = siteCollections.map((row) => `COL-WEB-${row.record_id}`);
  const [dbSales, dbCollections, dbExpenses, dbDeposits] = await Promise.all([
    saleIds.length ? sql`select sale_id as id, branch, coalesce(encoded_by_employee_id, '') as encoder, amount_paid::float8 as amount from sales where sale_id in ${sql(saleIds)}` : [],
    collectionIds.length ? sql`select collection_id as id, branch, coalesce(encoded_by_employee_id, '') as encoder, amount_collected::float8 as amount from collections where collection_id in ${sql(collectionIds)}` : [],
    sql`select expense_id as id from expenses where expense_id like 'EXP-WEB-%'`,
    sql`select deposit_id as id from bank_deposits where deposit_id like 'DEP-WEB-%'`,
  ]);
  const saleRow = new Map(dbSales.map((row) => [row.id, row])), collectionRow = new Map(dbCollections.map((row) => [row.id, row]));
  const haveExpense = new Set(dbExpenses.map((row) => row.id)), haveDeposit = new Set(dbDeposits.map((row) => row.id));

  const plan = { sales: [], collections: [], expenses: [], deposits: [] };
  const notes = { notInSystem: 0, alreadyEncoded: 0, alreadyAdded: 0, skippedTypes: new Map(), unknownBranch: new Set(), unresolved: 0 };
  const summary = new Map();
  const add = (clerk, what, value) => { const line = summary.get(clerk.employee_id) ?? { name: clerk.full_name, sales: 0, salesGross: 0, collections: 0, collectionsGross: 0, expenses: 0, expensesTotal: 0, deposits: 0, depositsTotal: 0 }; line[what] += 1; line[`${what}${what === "sales" || what === "collections" ? "Gross" : "Total"}`] += value; summary.set(clerk.employee_id, line); };

  for (const row of siteSales) {
    const id = `SALE-WEB-${row.record_id}`, db = saleRow.get(id), date = day(row.data_created_at || row["Created At"]);
    if (!db) { notes.notInSystem++; continue; }
    if (db.encoder) { notes.alreadyEncoded++; continue; }
    const member = members.get(str(row.member_id_value));
    const sameDay = member && day(member.data_created_at) === date && str(member.Encoder);
    const clerk = sameDay ? employeeFor(member.Encoder) : branchClerk(db.branch);
    if (!clerk) { notes.unresolved++; continue; }
    plan.sales.push({ id, clerk, date }); add(clerk, "sales", db.amount);
  }
  for (const row of siteCollections) {
    const id = `COL-WEB-${row.record_id}`, db = collectionRow.get(id), date = day(row.data_created_at || row["Created At"]);
    if (!db) { notes.notInSystem++; continue; }
    if (db.encoder) { notes.alreadyEncoded++; continue; }
    const clerk = branchClerk(db.branch);
    if (!clerk) { notes.unresolved++; continue; }
    plan.collections.push({ id, clerk, date }); add(clerk, "collections", db.amount);
  }
  for (const row of siteExpenses) {
    const id = `EXP-WEB-${row.record_id}`;
    if (haveExpense.has(id)) { notes.alreadyAdded++; continue; }
    const type = str(row["Type of Expense"]);
    if (skip.has(key(type))) { notes.skippedTypes.set(type, (notes.skippedTypes.get(type) ?? 0) + 1); continue; }
    const branch = branchName.get(key(row.Branch));
    if (!branch) { notes.unknownBranch.add(str(row.Branch)); notes.unresolved++; continue; }
    const clerk = employeeFor(row["Encoded By"]);
    if (!clerk) { notes.unresolved++; continue; }
    plan.expenses.push({ id, clerk, date: day(row.Date), recordedOn: day(row.Date), amount: amount(row.Amount), type, source: "old web app", values: {
      category: type || "Old web app expense", description: str(row["Member Burial"]) || null, payee: str(row.MAS) || null, branch,
      reference_number: str(row["OR#"]) || null, receipt_number: str(row["Receipt#"]) || null,
      remarks: [`Imported from the old web app (expense ${row.record_id}).`, str(row.Remarks)].filter(Boolean).join(" "),
    } }); add(clerk, "expenses", amount(row.Amount));
  }
  for (const row of siteDeposits) {
    const id = `DEP-WEB-${row.record_id}`;
    if (haveDeposit.has(id)) { notes.alreadyAdded++; continue; }
    const branch = branchName.get(key(row.Branch));
    if (!branch) { notes.unknownBranch.add(str(row.Branch)); notes.unresolved++; continue; }
    const clerk = employeeFor(row["Encoded By"]);
    if (!clerk) { notes.unresolved++; continue; }
    plan.deposits.push({ id, clerk, row, branch, date: day(row.Date), amount: amount(row.Amount) }); add(clerk, "deposits", amount(row.Amount));
  }

  /*
   * The old sheet (owner, October 29, 2026: it may hold data from October 1). Its New Sales and Collections were imported
   * as …-LEG-… with the sheet's Timestamp as their created date, and it has no encoder column: each goes to its branch's
   * clerk, encoded on its Timestamp day. Its "Expenses Entry" tab (no encoder either) is added the same way, as
   * EXP-LEG-<sheet row>, recorded on its Timestamp day.
   */
  const manila = (column) => sql`(${sql(column)} at time zone 'Asia/Manila')::date`;
  const [legSales, legCollections, legExpenses] = await Promise.all([
    sql`select sale_id as id, branch, amount_paid::float8 as amount, ${manila("date_created")}::text as day from sales
      where sale_id like '%-LEG-%' and coalesce(encoded_by_employee_id, '') = '' and ${manila("date_created")} between ${FROM}::date and ${TO}::date`,
    sql`select collection_id as id, branch, amount_collected::float8 as amount, ${manila("created_at")}::text as day from collections
      where collection_id like '%-LEG-%' and coalesce(encoded_by_employee_id, '') = '' and ${manila("created_at")} between ${FROM}::date and ${TO}::date`,
    sql`select expense_id as id from expenses where expense_id like 'EXP-LEG-%'`,
  ]);
  for (const db of legSales) {
    const clerk = branchClerk(db.branch);
    if (!clerk) { notes.unresolved++; continue; }
    plan.sales.push({ id: db.id, clerk, date: db.day, source: "old sheet" }); add(clerk, "sales", db.amount);
  }
  for (const db of legCollections) {
    const clerk = branchClerk(db.branch);
    if (!clerk) { notes.unresolved++; continue; }
    plan.collections.push({ id: db.id, clerk, date: db.day, source: "old sheet" }); add(clerk, "collections", db.amount);
  }
  let sheetExpenses = 0;
  if (fs.existsSync(OLD_SHEET)) {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(OLD_SHEET);
    const tab = book.getWorksheet("Expenses Entry");
    const cell = (value) => value?.result ?? (value?.richText ? value.richText.map((part) => part.text).join("") : value);
    const sheetDay = (value) => { const v = cell(value); if (v instanceof Date) return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(v); const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str(v)); return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : day(v); };
    const have = new Set(legExpenses.map((row) => row.id));
    const head = Array.from(tab?.getRow(1).values ?? [], (value) => key(cell(value)));
    const at = (name) => head.findIndex((value) => value.startsWith(name));
    const col = { stamp: at("timestamp"), branch: at("branch"), date: at("date of expense"), account: at("account name"), amount: at("amount"), receipt: at("invoice"), purpose: at("purpose"), approved: at("approved by"), remarks: at("remarks") };
    tab?.eachRow((row, number) => {
      if (number === 1) return;
      const v = row.values, recorded = sheetDay(v[col.stamp]);
      if (!(recorded >= FROM && recorded <= TO)) return;
      sheetExpenses++;
      const id = `EXP-LEG-${number}`;
      if (have.has(id)) { notes.alreadyAdded++; return; }
      const type = str(cell(v[col.purpose])) || str(cell(v[col.account]));
      if (skip.has(key(type))) { notes.skippedTypes.set(type, (notes.skippedTypes.get(type) ?? 0) + 1); return; }
      const branch = branchName.get(key(cell(v[col.branch])));
      if (!branch) { notes.unknownBranch.add(str(cell(v[col.branch]))); notes.unresolved++; return; }
      const clerk = branchClerk(branch);
      if (!clerk) { notes.unresolved++; return; }
      const value = amount(cell(v[col.amount]));
      plan.expenses.push({ id, clerk, date: sheetDay(v[col.date]) || recorded, recordedOn: recorded, amount: value, type, source: "old sheet", values: {
        category: str(cell(v[col.account])) || "Old sheet expense", description: str(cell(v[col.purpose])) || null, branch, receipt_number: str(cell(v[col.receipt])) || null,
        approved_by: str(cell(v[col.approved])) || null, remarks: [`Imported from the old sheet (Expenses Entry row ${number}).`, str(cell(v[col.remarks]))].filter(Boolean).join(" "),
      } }); add(clerk, "expenses", value);
    });
  } else console.log(`Old sheet not found (${OLD_SHEET}): its Expenses Entry tab is not read.`);

  console.log(`\nOld-site records created in the month: ${siteSales.length} New Sales, ${siteCollections.length} Collections, ${siteExpenses.length} expenses, ${siteDeposits.length} bank/GCash remittances.`);
  const fromSheet = (list) => list.filter((item) => item.source === "old sheet").length;
  console.log(`Old sheet, created in the month and with no clerk: ${legSales.length} New Sales, ${legCollections.length} Collections in the system; ${sheetExpenses} rows of its Expenses Entry tab.`);
  console.log(`To give a clerk or add: New Sales ${plan.sales.length} (${fromSheet(plan.sales)} old sheet), Collections ${plan.collections.length} (${fromSheet(plan.collections)} old sheet), expenses ${plan.expenses.length} (${fromSheet(plan.expenses)} old sheet), bank/GCash remittances ${plan.deposits.length}.`);
  console.log(`Old web app records not in this system (left out of the import): ${notes.notInSystem} · already with an encoder: ${notes.alreadyEncoded} · expenses/remittances already added: ${notes.alreadyAdded}`);
  for (const [type, n] of notes.skippedTypes) console.log(`Expense type skipped (skipExpenseTypes): ${type} × ${n}`);
  const incentiveLike = [...new Set(plan.expenses.filter((item) => /incentive|\borc\b/i.test(item.type)).map((item) => item.type))];
  if (incentiveLike.length) console.log(`CHECK: these expense types look like incentives; add them to skipExpenseTypes if this system already counts them: ${incentiveLike.join(" | ")}`);

  console.log("\nPer clerk (what their reports will gain):");
  console.table([...summary.entries()].map(([id, line]) => ({ clerk: `${id} ${line.name}`, newSales: line.sales, salesGross: line.salesGross, collections: line.collections, collectionsGross: line.collectionsGross, expenses: line.expenses, expensesTotal: line.expensesTotal, bankGcash: line.deposits, bankGcashTotal: line.depositsTotal })));

  const temporary = [...summary.entries()].filter(([id]) => id.startsWith("LEG-"));
  if (temporary.length) console.log(`\nCHECK: matched to a temporary LEG MAS record, not a clerk's own record: ${temporary.map(([id, line]) => `${id} ${line.name}`).join("; ")}. If the clerk has their own Employee ID, put the old-site name and that ID in "encoders".`);
  if (askOwner.size) {
    console.log(`\nASK THE OWNER: whose report gets each branch's old collections (old site and old sheet) and old-sheet New Sales and expenses? Put "BRANCH": "Employee ID" in ${CONFIG_FILE} "branches".`);
    for (const [branch, clerks] of askOwner) console.log(`  ${branch}: ${clerks.length ? clerks.join("; ") : "no Entry Clerk assigned to this branch"}`);
  }
  if (unmatched.size) {
    console.log(`\nOLD-SITE NAMES NOT MATCHED to one employee: put "NAME": "Employee ID" in ${CONFIG_FILE} "encoders".`);
    for (const [name, fits] of unmatched) console.log(`  ${name}: ${fits.length ? `more than one fits: ${fits.join("; ")}` : "no employee fits"}`);
  }
  if (notes.unknownBranch.size) console.log(`\nOld-site branches not found here: ${[...notes.unknownBranch].join(", ")}`);
  console.log(`\nUnresolved records: ${notes.unresolved}`);

  if (!APPLY) { console.log("\nDry run: nothing written. Resolve the lists above, then run again with --apply."); }
  else if (notes.unresolved && !ROLLBACK) { console.log("\nNot applied: resolve every record above first (config/old-site-report-clerks.json), then run --apply again."); process.exitCode = 1; }
  else {
    await sql.begin(async (tx) => {
      await tx`select set_config('app.user_name', ${BY}, true)`;
      const encoder = (clerk, date) => ({ encoded_by_user_id: userOf.get(clerk.employee_id) ?? null, encoded_by_employee_id: clerk.employee_id, encoded_by_name: clerk.full_name, encoded_at: noon(date) });
      for (const item of plan.sales) await tx`update sales set ${tx(encoder(item.clerk, item.date))} where sale_id = ${item.id} and coalesce(encoded_by_employee_id, '') = ''`;
      for (const item of plan.collections) await tx`update collections set ${tx(encoder(item.clerk, item.date))} where collection_id = ${item.id} and coalesce(encoded_by_employee_id, '') = ''`;
      // The report places an expense on the day it was recorded (encoded_at), its expense date stays as written.
      for (const item of plan.expenses) await tx`insert into expenses ${tx({
        expense_id: item.id, expense_date: item.date, amount: item.amount, status: "Posted", ...item.values, created_at: noon(item.recordedOn), ...encoder(item.clerk, item.recordedOn),
      })} on conflict (expense_id) do nothing`;
      for (const item of plan.deposits) await tx`insert into bank_deposits ${tx({
        deposit_id: item.id, deposit_date: item.date, employee_id: item.clerk.employee_id, employee_name: item.clerk.full_name, branch: item.branch,
        bank_account_name: [str(item.row["Bank GCash No"]), str(item.row.Type)].find((value) => value && value !== "—") || null, amount: item.amount, transfer_type: str(item.row.Type) || null, mas: str(item.row.MAS) || null,
        remarks: [`Imported from the old web app (remittance ${item.row.record_id}).`, str(item.row["Reference No"]) && `Ref ${str(item.row["Reference No"])}.`, str(item.row.Remarks)].filter(Boolean).join(" "), status: "Posted", created_at: noon(item.date),
      })} on conflict (deposit_id) do nothing`;
      await tx`insert into record_corrections ${tx({
        correction_id: `COR-WEB-REPORTS-${MONTH}-${Date.now().toString(36).toUpperCase()}`, module: BY, record_id: `REPORTS-${MONTH}`,
        reason: `Owner, October 29, 2026: complete the Entry Clerks' ${MONTH} reports with the old web app and old sheet records of the month.`,
        before_json: null, after_json: { newSales: plan.sales.length, collections: plan.collections.length, expenses: plan.expenses.length, deposits: plan.deposits.length, branches: config.branches, encoders: config.encoders },
        corrected_at: new Date().toISOString(), encoded_by_name: BY, encoded_at: new Date().toISOString(),
      })}`;
      if (ROLLBACK) {
        const [check] = await tx`select (select count(*) from sales where sale_id in ${tx(plan.sales.map((item) => item.id).concat("-"))} and encoded_by_employee_id is not null)::int as sales,
          (select count(*) from collections where collection_id in ${tx(plan.collections.map((item) => item.id).concat("-"))} and encoded_by_employee_id is not null)::int as collections,
          (select count(*) from expenses where expense_id like 'EXP-WEB-%' or expense_id like 'EXP-LEG-%')::int as expenses, (select count(*) from bank_deposits where deposit_id like 'DEP-WEB-%')::int as deposits`;
        console.log(`
Written inside the test transaction: ${JSON.stringify(check)}. Rolling back.`);
        throw new Error("ROLLBACK");
      }
    }).catch((error) => { if (error.message !== "ROLLBACK") throw error; });
    if (ROLLBACK) { console.log("Rolled back: nothing kept."); process.exit(0); }
    console.log(`\nApplied: ${plan.sales.length} New Sales and ${plan.collections.length} Collections given their clerk; ${plan.expenses.length} expenses and ${plan.deposits.length} bank/GCash remittances added.`);
  }
} finally {
  await sql.end();
}

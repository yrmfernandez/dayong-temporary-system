/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { before, beforeEach, test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the actual TS routes/data helpers with an in-memory Sheets transport.
// No credentials, network calls, or production rows are used by these tests.
process.env.AUTH_SECRET ||= 'test-secret-for-session-tokens-only';
// Modules that moved to PostgreSQL run against PGlite: a real PostgreSQL inside this process, built from the same
// migration files as Supabase and emptied before every test. No network and no staging data.
let pglite;
before(async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const { drizzle } = require('drizzle-orm/pglite');
  const { migrate } = require('drizzle-orm/pglite/migrator');
  pglite = new PGlite();
  const db = drizzle(pglite);
  await migrate(db, { migrationsFolder: path.resolve('db/migrations') });
  globalThis.dayongTestDb = db;
});
beforeEach(async () => {
  const { rows } = await pglite.query("select string_agg(format('%I', tablename), ', ') as names from pg_tables where schemaname = 'public'");
  await pglite.exec(`truncate ${rows[0].names} restart identity cascade`);
});
/** Inserts rows (objects keyed by column name) into a database table. */
async function seed(table, rows, { skipExisting = false } = {}) {
  for (const row of rows) {
    const columns = Object.keys(row);
    const values = columns.map((column) => row[column] !== null && typeof row[column] === 'object' ? JSON.stringify(row[column]) : row[column]);
    await pglite.query(`insert into "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')})${skipExisting ? ' on conflict do nothing' : ''}`, values);
  }
}
/** Programs and the accountable employee a New Sale links to in the database (the sheets still list them for the form). */
async function seedSaleLinks(programs = [['DP-1', 'Program']], employee = ['DPE-0002', 'MAS']) {
  await seed('programs', programs.map(([program_id, program_name]) => ({ program_id, program_name, base_pay: 350 })), { skipExisting: true });
  await seed('employees', [{ employee_id: employee[0], full_name: employee[1] }], { skipExisting: true });
}
const count = async (table) => (await query(`select count(*)::int as n from "${table}"`))[0].n;

/*
 * Master data (branches, employees and their branches, programs, incentive tiers, remittance methods) moved to the
 * database, but many tests describe it as sheet rows (h.rows). Before each route call the harness copies those rows
 * into PGlite: only rows that changed since the last copy, so a row the code itself saved or edited is never
 * overwritten, and rows a test removed from h.rows are removed. A link to an employee, branch or program a test never
 * set up gets a placeholder row, as the sheets had no such checks.
 */
const cell = (row, index) => { const value = row?.[index]; return value === undefined || value === null || String(value).trim() === '' ? null : typeof value === 'string' ? value.trim() : value; };
const flag = (value) => value === true || /^(true|yes|1)$/i.test(String(value ?? '').trim());
const number = (value) => { const parsed = Number(value); return value === null || value === undefined || String(value).trim() === '' || !Number.isFinite(parsed) ? null : parsed; };
const MASTER_TABS = [
  ['Branches', 'branches', 'branch_id', (r) => ({ branch_id: cell(r, 0), branch_name_code: cell(r, 1) ?? cell(r, 0), territory: cell(r, 2), barangay: cell(r, 3), city_municipality: cell(r, 4), province: cell(r, 5), country: cell(r, 6), postal_code: cell(r, 7), contact_number: cell(r, 8), email: cell(r, 9), status: r.length >= 13 ? (cell(r, 12) ?? 'active') : 'active' })],
  ['Employees', 'employees', 'employee_id', (r) => ({ employee_id: cell(r, 0), full_name: cell(r, 1) ?? cell(r, 0), primary_branch: cell(r, 2), operational_roles: cell(r, 3), employment_status: cell(r, 4), contact_number: cell(r, 5) === null ? null : String(cell(r, 5)), email: cell(r, 6) })],
  ['Programs', 'programs', 'program_id', (r) => ({ program_id: cell(r, 0), program_code: cell(r, 1) === null ? null : String(cell(r, 1)), program_name: cell(r, 2) ?? cell(r, 0), base_pay: number(r[3]), status: cell(r, 4), description: cell(r, 5), registration_fee_required: flag(r[10]), registration_amount: number(r[11]), pay_balance_total: number(r[12]), age_restricted: flag(r[13]), min_age: number(r[14]), max_age: number(r[15]), new_sale_incentive_type: cell(r, 16), new_sale_incentive_amount: number(r[17]), category_id: cell(r, 18), new_sale_amount_editable: flag(r[19]), collection_amount_editable: flag(r[20]) })],
  ['Employee Branches', 'employee_branches', 'assignment_id', (r) => ({ assignment_id: cell(r, 0), employee_id: cell(r, 1), branch_id: cell(r, 2) })],
  ['Program Incentives', 'program_incentives', 'incentive_id', (r) => ({ incentive_id: cell(r, 0), program_id: cell(r, 1), role: cell(r, 2), from_month: number(r[3]), to_month: number(r[4]), incentive_type: cell(r, 5), mark_up: number(r[6]), incentive_amount: number(r[7]), branch_id: cell(r, 12) })],
  ['Remittance Methods', 'remittance_methods', 'remittance_method_id', (r) => ({ remittance_method_id: cell(r, 0), method_name: cell(r, 1), is_cash: flag(r[2]), requires_reference: flag(r[3]), status: cell(r, 4) })],
];
async function upsert(table, key, row) {
  const columns = Object.keys(row);
  const values = columns.map((column) => row[column]);
  const updates = columns.filter((column) => column !== key).map((column) => `"${column}" = excluded."${column}"`).join(', ');
  await pglite.query(`insert into "${table}" (${columns.map((column) => `"${column}"`).join(', ')}) values (${columns.map((_, index) => `$${index + 1}`).join(', ')}) on conflict ("${key}") do ${updates ? `update set ${updates}` : 'nothing'}`, values);
}
async function placeholder(table, key, id, extra) {
  if (id) await pglite.query(`insert into "${table}" ("${key}", ${Object.keys(extra).map((column) => `"${column}"`).join(', ')}) values ($1, ${Object.keys(extra).map((_, index) => `$${index + 2}`).join(', ')}) on conflict do nothing`, [id, ...Object.values(extra)]);
}
async function syncMasterData(rows, synced, load) {
  // Setup data is not an edit by the code under test, so the audit trigger (and link checks) are off while it is copied.
  await pglite.query("set session_replication_role = replica");
  try {
    await copyMasterData(rows, synced);
    // Sales and Collections rows given as sheet rows are loaded through the database-backed Sheets API, positionally.
    for (const tab of ['Sales', 'Collections']) {
      const data = (rows[tab] ?? []).slice(1).filter((row) => row && row.length);
      const signature = JSON.stringify(data);
      if (!data.length || synced.get(`tab|${tab}`) === signature) continue;
      await pglite.query(`delete from "${tab.toLowerCase()}"`);
      await load('lib/sheets-on-db.ts').sheetsOnDb.spreadsheets.values.append({ range: `'${tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: data } });
      synced.set(`tab|${tab}`, signature);
    }
  } finally { await pglite.query("set session_replication_role = origin"); }
}
async function copyMasterData(rows, synced) {
  for (const [tab, table, key, convert] of MASTER_TABS) {
    const current = new Map();
    for (const raw of (rows[tab] ?? []).slice(1)) { const row = convert(raw); if (row[key]) current.set(String(row[key]), row); }
    for (const [id, row] of current) {
      const signature = JSON.stringify(row);
      if (synced.get(`${table}|${id}`) === signature) continue;
      if (table === 'employee_branches') { await placeholder('employees', 'employee_id', row.employee_id, { full_name: row.employee_id }); await placeholder('branches', 'branch_id', row.branch_id, { branch_name_code: row.branch_id }); }
      if (table === 'program_incentives') { await placeholder('programs', 'program_id', row.program_id, { program_name: row.program_id }); await placeholder('branches', 'branch_id', row.branch_id, { branch_name_code: row.branch_id }); }
      await upsert(table, key, row);
      synced.set(`${table}|${id}`, signature);
    }
    for (const entry of [...synced.keys()].filter((item) => item.startsWith(`${table}|`))) {
      const id = entry.slice(table.length + 1);
      if (current.has(id)) continue;
      synced.delete(entry);
      await pglite.query(`delete from "${table}" where "${key}" = $1`, [id]).catch(() => undefined);
    }
  }
}
const query = async (text, params) => (await pglite.query(text, params)).rows;
/** A member with one program account, the minimum other rows link to. */
async function seedAccount({ enrollment = 'ENR-1', member = 'MEM-1', memberNumber = 'PH-1', program = 'DP-1', programName = 'Program', basePay = 350, payBalanceTotal = null, doi = null, branch = 'BR-1', mas = 'MAS-2', surname = 'Santos', firstName = 'Ana', accountStatus = null } = {}) {
  await seed('members', [{ member_id: member, member_number: memberNumber, surname, first_name: firstName }]);
  await seed('programs', [{ program_id: program, program_name: programName, base_pay: basePay, pay_balance_total: payBalanceTotal }]);
  await seed('member_programs', [{ enrollment_id: enrollment, member_id: member, member_number: memberNumber, program_id: program, doi, branch, mas, status: 'Active', account_status: accountStatus }]);
}

// Headers added by npm run sheets:remittance-deadline, which Remittances requires.
function deadlineHeaders(h) {
  for (const [title, index, name] of [['Collections', 38, 'forfeited_incentive'], ['Sales', 43, 'forfeited_incentive'], ['Remittances', 26, 'time_remitted'], ['Remittances', 27, 'cash_count']]) {
    const rows = h.rows[title] ?? (h.rows[title] = [[]]);
    rows[0] = [...(rows[0] ?? [])];
    rows[0][index] = name;
  }
}

function harness(user = { userId: 'USR-1', employeeId: 'DPE-0001', name: '=encoder', roleNames: ['Entry Clerk'], permissions: {} }) {
  const cache = new Map();
  const writes = [];
  const rows = {};
  let missingHeaders = false;
  const titles = ['Member programs', 'Members', 'Programs', 'Collections', 'Remittances', 'Remittance Collections', 'Sales', 'Beneficiaries', 'Branches', 'Employees', 'Employee Branches', 'Users', 'User Roles', 'Roles', 'Program Incentives', 'Receipt Photos', 'Bank Deposits', 'Report Notes'];
  const sheets = { spreadsheets: {
    get: async () => ({ data: { sheets: titles.map((title, sheetId) => ({ properties: { title, sheetId } })) } }),
    batchUpdate: async (params) => { writes.push(params); return { data: {} }; },
    values: {
    batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map((range) => {
      const title = range.split('!')[0].replace(/^'|'$/g, '');
      return { values: rows[range] ?? rows[title] ?? [[]] };
    }) } }),
    get: async ({ range }) => {
      if (range === "'Member programs'!S1") return { data: { values: [['Account Status']] } };
      if (/^'?Branches'?!A:M$/.test(range)) return { data: { values: rows.Branches ?? [[]] } };
      if (/^'?Roles'?!A:[GL]$/.test(range)) return { data: { values: rows.Roles ?? [[]] } };
      if (/^'?Users'?!A:(?:B|G|H|Z)$/.test(range)) return { data: { values: rows.Users ?? [[]] } };
      if (range === "'Audit Log'!A:J") return { data: { values: rows['Audit Log'] ?? [[]] } };
      if (range.startsWith("'Receipt Photos'")) return { data: { values: rows['Receipt Photos'] ?? [[]] } };
      if (range.startsWith("'Bank Deposits'")) return { data: { values: rows['Bank Deposits'] ?? [[]] } };
      if (range.startsWith("'Report Notes'")) return { data: { values: rows['Report Notes'] ?? [[]] } };
      if (range === 'Expenses!V1:W1' || range === 'Sales!AO1:AQ1') return { data: { values: rows[range] ?? [[]] } };
      if (/!A:ZZ$/.test(range)) return { data: { values: rows[range.split('!')[0].replace(/^'|'$/g, '')] ?? [[]] } };
      const schema = load('lib/encoder-schema.ts').getEncoderSheet(range);
      return { data: { values: /1:.*1$/.test(range)
        ? [missingHeaders ? [] : load('lib/encoder-schema.ts').trackingHeaders(schema.title)]
        : (rows[schema.title] ?? [[]]) } };
    },
    append: async (params) => { writes.push(params); return { data: {} }; },
    update: async (params) => { writes.push(params); return { data: {} }; },
    batchUpdate: async (params) => { writes.push(params); return { data: {} }; },
  } } };
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const source = ts.transpileModule(fs.readFileSync(path.resolve(file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const localRequire = (name) => {
      if (name === '@/lib/auth-server') {
        // Page and job permissions use the real access rules against the test session.
        const access = load('lib/access-control.ts');
        const withRoles = () => user && { roleNames: [], ...user, permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false, ...user.permissions } };
        return {
          getSessionUser: async () => user,
          canManageUsers: async () => Boolean(user?.permissions?.manageUsers),
          canManageAttendance: async () => Boolean(user?.permissions?.manageAttendance),
          canManageAccounts: async () => Boolean(user && access.canManageAccountsFor(withRoles())),
          canManageEmployees: async () => Boolean(user && access.canManageEmployeesFor(withRoles())),
          canManageConfiguration: async () => Boolean(user && access.canManageConfigurationFor(withRoles())),
          userWithPageAccess: async (...paths) => user && paths.some((path) => access.canAccessPath(withRoles(), path)) ? user : null,
        };
      }
      if (name === '@/lib/google-sheets') return { sheets, GOOGLE_SHEET_ID: 'test', withWriteLock: (key, work) => work(), readingFresh: (work) => work(), sheetsStats: () => ({}) };
      if (name === 'next/server') return { NextResponse: Response };
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  const synced = new Map();
  const sync = () => syncMasterData(rows, synced, load);
  // Route handlers (GET, POST, …) copy the master data rows into the database first; lib modules call h.sync() themselves.
  const loadForTest = (file) => {
    const loaded = load(file);
    if (!file.startsWith('app/')) return loaded;
    return Object.fromEntries(Object.entries(loaded).map(([name, value]) => [name, typeof value === 'function' && /^(GET|POST|PUT|PATCH|DELETE)$/.test(name) ? async (...args) => { await sync(); return value(...args); } : value]));
  };
  return { load: loadForTest, sync, rows, writes, setUser: (value) => { user = value; }, missingHeaders: () => { missingHeaders = true; } };
}

function request(body = {}) {
  return new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

test('employee registration is independent of login and records its encoder', async () => {
  const h = harness(null);
  const route = h.load('app/api/employees/route.ts');
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.POST(request({}))).status, 401);
  h.setUser({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: {} });
  assert.equal((await route.POST(request({}))).status, 403);
  h.setUser({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  h.rows.Employees = [[], ['DPE-0002', 'Ana', 'North', 'MAS', 'active']];
  h.rows.Users = [[], ['U1', 'DPE-0005']];
  h.rows.Branches = [[], ['BR-1', 'South', 'DDO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Roles = [[], ['R1', 'MAS', '', '', '', '', 'active'], ['R2', 'Collector', '', '', '', '', 'active']];
  const response = await route.POST(request({ employeeId: 'MD-2099-0101', name: '=Staff', branchIds: ['BR-1'], roles: ['Collector', 'MAS'], dateHired: '2026-09-25', encodedBy: 'spoof' }));
  assert.equal(response.status, 201);
  const registered = await response.json();
  assert.equal(registered.employee.id, 'MD-2099-0101');
  // Registration saves the employee and their branch in the database, and creates the sign-in account (Users and
  // User Roles rows, still in the sheets).
  const [employee] = await query("select * from employees where employee_id = 'MD-2099-0101'");
  assert.equal(employee.full_name, '=Staff', 'stored as typed; the database never evaluates formulas');
  assert.equal(employee.primary_branch, 'South', 'a single assigned branch is the primary branch');
  assert.deepEqual([employee.encoded_by_user_id, employee.employment_status, employee.operational_roles], ['U1', 'active', 'Collector, MAS']);
  assert.deepEqual((await query("select branch_id from employee_branches where employee_id = 'MD-2099-0101'")).map((row) => row.branch_id), ['BR-1']);
  assert.deepEqual(h.writes.map((write) => write.range.split('!')[0]), ["'Users'", "'User Roles'"]);
  // An administrator or IT registering the employee receives the account's one-time password to hand over.
  assert.equal(registered.account.created, true);
  assert.match(registered.account.oneTimePassword, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  const userRow = h.writes.find((write) => write.range.startsWith("'Users'!")).requestBody.values[0];
  assert.equal(userRow[1], 'MD-2099-0101');
  const opened = await h.load('lib/passwords.ts').checkPassword(registered.account.oneTimePassword, userRow[3]);
  assert.deepEqual(opened, { matches: true, oneTime: true, expired: false }, 'the account opens with its one-time password');
  assert.equal(await h.load('lib/passwords.ts').checkPassword('password12345', userRow[3]).then((result) => result.matches), false, 'the shared default password is never issued');
  assert.deepEqual(h.writes.find((write) => write.range.startsWith("'User Roles'!")).requestBody.values.map((values) => values.slice(0, 2)), [['USR-0001', 'R1'], ['USR-0001', 'R2']], 'each employee role is the same account role');
  // Collector is an ordinary role, so a Collector-only employee gets an account too.
  h.rows.Branches.push(['BR-2', 'North', 'DDO 1', '', '', '', '', '', '', '', '', '', 'active']);
  const collector = await (await route.POST(request({ employeeId: 'MD-2099-0102', name: 'Col Lector', branchIds: ['BR-1', 'BR-2'], primaryBranchId: 'BR-2', roles: ['Collector'] }))).json();
  assert.equal(collector.account.created, true);
  // A role added later on the Roles page is offered at registration and gets an account the same way.
  h.rows.Roles.push(['R3', 'Cashier', '', '', '', '', 'active']);
  assert.ok((await (await route.GET()).json()).operationalRoles.includes('Cashier'));
  const cashier = await (await route.POST(request({ employeeId: 'MD-2099-0105', name: 'Cash Ier', branchIds: ['BR-1'], roles: ['Cashier'] }))).json();
  assert.equal(cashier.account.created, true);
  assert.equal((await (await route.POST(request({ employeeId: 'MD-2099-0106', name: 'Made Up', branchIds: ['BR-1'], roles: ['Not A Role'] }))).json()).message, 'One or more operational roles are invalid.');
  // The primary branch must be chosen from the assigned branches.
  assert.match((await (await route.POST(request({ employeeId: 'MD-2099-0103', name: 'Two Branches', branchIds: ['BR-1', 'BR-2'], roles: ['MAS'] }))).json()).message, /Choose the primary branch/);
  assert.match((await (await route.POST(request({ employeeId: 'MD-2099-0104', name: 'Wrong Primary', branchIds: ['BR-1'], primaryBranchId: 'BR-2', roles: ['MAS'] }))).json()).message, /one of the assigned branches/);
  assert.equal((await route.POST(request({ name: 'Bad', branchIds: ['BR-X'], roles: ['Invented'] }))).status, 400);
  const data = await (await route.GET()).json();
  assert.equal(data.employees[0].name, 'Ana');
  assert.equal('passwordHash' in data.employees[0], false);
});

test('employee status updates and deletion protect linked login accounts', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  const route = h.load('app/api/employees/route.ts');
  h.rows.Employees = [[], ['DPE-0002', 'Ana', 'North', 'MAS, Collector', 'active']];
  h.rows.Users = [[]];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  let response = await route.PATCH(request({ employeeId: 'DPE-0002', status: 'resigned' }));
  assert.equal(response.status, 200);
  assert.equal((await query("select employment_status from employees where employee_id = 'DPE-0002'"))[0].employment_status, 'resigned');
  // A linked sign-in account blocks the delete.
  h.rows.Users = [[], ['USR-2', 'DPE-0002']];
  response = await route.DELETE(request({ employeeId: 'DPE-0002' }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).message, /linked user account/);
  h.rows.Users = [[]];
  response = await route.DELETE(request({ employeeId: 'DPE-0002' }));
  assert.equal(response.status, 200);
  assert.deepEqual([await count('employees'), await count('employee_branches')], [0, 0], 'the employee and their branch assignments are gone');
});

test('user account edits preserve the primary role and save updated roles', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-2', 'DPE-0002', 'Ana', 'hash', 'Active', '', 'ROLE-ENTRY-CLERK']];
  h.rows.Roles = [[], ['ROLE-ENTRY-CLERK', 'Entry Clerk', '', '', '', '', 'active'], ['ROLE-MAS', 'MAS', '', '', '', '', 'active']];
  h.rows['User Roles'] = [[]];
  const route = h.load('app/api/user-accounts/route.ts');
  const loaded = await (await route.GET()).json();
  assert.deepEqual(loaded.accounts[0].roleIds, ['ROLE-ENTRY-CLERK']);
  const response = await route.PATCH(request({ id: 'USR-2', status: 'active', roleIds: ['ROLE-ENTRY-CLERK', 'ROLE-MAS'], password: '' }));
  assert.equal(response.status, 200, JSON.stringify(await response.json()));
  assert.ok(h.writes.some((write) => write.requestBody?.data?.some?.((item) => item.range === 'Users!E2')));
  assert.ok(h.writes.some((write) => write.range === "'User Roles'!A:F"));
  assert.ok(!h.writes.some((write) => write.requestBody?.data?.some?.((item) => /^'User Roles'!Ad/.test(item.range))), 'old role links are deleted, never blanked');
});

test('expense entries follow the company form: account, attachments, approver, and page access', async () => {
  const h = harness({ userId: 'U3', employeeId: 'DPE-0003', name: 'finance', roleNames: ['Finance'], permissions: {} });
  const route = h.load('app/api/expenses/route.ts');
  const entry = { branch: 'BALIOK', date: '2026-09-30', category: 'Other', categoryOther: 'Parking', amount: 150, attachments: ['Receipt', 'Voucher', 'Other'], attachmentOther: 'Gate pass', receiptNumber: 'OR-77', description: 'Client visit parking', approvedBy: 'CEO/President', remarks: '' };
  const missing = await route.POST(request(entry));
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).message, /sheets:expense-fields/, 'saving before the migration explains how to fix it');
  h.rows['Expenses!V1:W1'] = [['attachments', 'approved_by']];
  const saved = await route.POST(request(entry));
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
  const write = h.writes.find((item) => item.range === "'Expenses'!A:W");
  assert.ok(write, 'the row spans the business, encoder, and form columns');
  const row = write.requestBody.values[0];
  assert.equal(row[2], 'Other: Parking');
  assert.equal(row[3], 'Client visit parking');
  assert.equal(row[6], 'Cash on Hand', 'paid from defaults to Cash on Hand');
  assert.deepEqual(row.slice(-2), ['Voucher, Receipt, Other: Gate pass', 'CEO/President']);
  assert.equal((await route.POST(request({ ...entry, category: 'Snacks' }))).status, 400, 'only listed accounts are accepted');
  assert.equal((await route.POST(request({ ...entry, approvedBy: 'Other', approvedByOther: '' }))).status, 400, 'an Other approver must be named');
  h.setUser({ userId: 'U8', employeeId: 'DPE-0008', name: 'mas', roleNames: ['MAS'], permissions: {} });
  assert.equal((await route.POST(request(entry))).status, 403, 'MAS cannot post expenses');
});

test('statement of account lists the new sale and every collection with running totals, for administrators only', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  await seedAccount({ programName: 'DS-320', basePay: 320, payBalanceTotal: 19200, doi: '2026-06-15', branch: 'MINTAL', mas: 'Maria', accountStatus: 'U' });
  await query("update members set member_contact = '0917', address = 'Mintal, Davao City' where member_id = 'MEM-1'");
  await seed('collections', [{ collection_id: 'COL-1', collection_batch_id: 'CBT-1', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', mas: 'Maria', or_number: 'OR-100', or_date: '2026-07-10', amount_collected: 640, month_from: '2026-07', month_to: '2026-08', nop_from: 2, nop_to: 3, status: 'Posted' }]);
  await seed('sales', [{ sale_id: 'SAL-1', member_number: 'PH-1', program_id: 'DP-1', amount_paid: 320, application_no: 'APP-1', or_date: '2026-06-15' }]);
  const route = h.load('app/api/soa/route.ts');
  const list = await (await route.GET(new Request('http://localhost/api/soa'))).json();
  assert.deepEqual(list.accounts.map((item) => [item.id, item.memberName, item.programName]), [['ENR-1', 'Santos, Ana', 'DS-320']]);
  const response = await route.GET(new Request('http://localhost/api/soa?account=ENR-1'));
  const { statement } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(statement.member.name, 'Ana Santos');
  assert.equal(statement.member.address, 'Mintal, Davao City');
  assert.deepEqual(statement.newSale.amount, 320);
  assert.deepEqual(statement.history.map((row) => [row.orNumber, row.monthFrom, row.monthTo, row.nopFrom, row.nopTo, row.runningTotal]), [['OR-100', '2026-07', '2026-08', 2, 3, 640]]);
  assert.equal(statement.summary.totalPaid, 960, 'the new sale plus collections');
  assert.equal(statement.summary.monthsPaid, 3);
  assert.equal(statement.summary.nextNop, 4);
  assert.equal(statement.summary.nextMonth, '2026-09');
  assert.equal(statement.summary.remainingBalance, 18560, 'pay-the-balance total less collections');
  h.setUser({ userId: 'U3', employeeId: 'DPE-0003', name: 'finance', roleNames: ['Finance'], permissions: {} });
  assert.equal((await route.GET(new Request('http://localhost/api/soa'))).status, 403);
});

test('IT manages ordinary accounts and roles but cannot hand out administrator power', async () => {
  const h = harness({ userId: 'U9', employeeId: 'DPE-0009', name: 'it', roleNames: ['IT Clerk'], permissions: {} });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-2', 'DPE-0002', 'Ana', 'hash', 'active', '', 'ROLE-MAS'], ['USR-1', 'DPE-0001', 'Boss', 'hash', 'active', '', 'ROLE-ADMIN']];
  h.rows.Roles = [[], ['ROLE-ADMIN', 'Administrator', '', 'TRUE', 'TRUE', 'TRUE', 'active'], ['ROLE-MAS', 'MAS', '', 'FALSE', '', '', 'active'], ['ROLE-ENTRY', 'Entry Clerk', '', 'FALSE', '', '', 'active']];
  h.rows['User Roles'] = [[], ['USR-2', 'ROLE-MAS'], ['USR-1', 'ROLE-ADMIN']];
  const accounts = h.load('app/api/user-accounts/route.ts');
  assert.equal((await accounts.GET()).status, 200, 'IT can open User Accounts without the manage_users flag');
  assert.equal((await accounts.PATCH(request({ id: 'USR-2', status: 'active', roleIds: ['ROLE-ENTRY'] }))).status, 200, 'IT can change an ordinary account');
  assert.equal((await accounts.PATCH(request({ id: 'USR-2', status: 'active', roleIds: ['ROLE-ADMIN'] }))).status, 403, 'IT cannot grant Administrator');
  assert.equal((await accounts.PATCH(request({ id: 'USR-1', status: 'inactive', roleIds: ['ROLE-MAS'] }))).status, 403, "IT cannot demote an administrator's account");
  assert.equal((await accounts.DELETE(request({ id: 'USR-1' }))).status, 403, "IT cannot delete an administrator's account");
  const roles = h.load('app/api/roles/route.ts');
  assert.equal((await roles.PATCH(request({ id: 'ROLE-MAS', name: 'MAS', manageUsers: true }))).status, 403, 'IT cannot turn on manage users');
  assert.equal((await roles.PATCH(request({ id: 'ROLE-ADMIN', name: 'Administrator', manageUsers: true }))).status, 403, 'IT cannot edit the Administrator role');
});

test('master-data CRUD updates programs and blocks deleting referenced records', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  const route = h.load('app/api/programs/route.ts');
  h.rows.Programs = [[], ['DP-0001', 'P1', 'Plan One', 350, 'active', '']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-0001', 'MAS', 1, 12, 'percentage', 50, 30]];
  await seedAccount({ enrollment: 'MP-1', program: 'DP-0001' });
  const input = { code: 'P1', name: 'Plan Updated', basePay: 400, status: 'active', description: '', incentiveTiers: [{ role: 'MAS', fromMonth: 1, toMonth: 12, incentiveType: 'percentage', markUp: 50, incentiveAmount: 30 }] };
  const updated = await route.PUT(new Request('http://localhost/api/programs?id=DP-0001', { method: 'PUT', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } }));
  assert.equal(updated.status, 200);
  const [program] = await query("select program_name, base_pay from programs where program_id = 'DP-0001'");
  assert.deepEqual([program.program_name, Number(program.base_pay)], ['Plan Updated', 400]);
  assert.deepEqual((await query("select role, from_month, to_month from program_incentives where program_id = 'DP-0001'")), [{ role: 'MAS', from_month: 1, to_month: 12 }], 'the tiers are replaced, not added');
  const deleted = await route.DELETE(new Request('http://localhost/api/programs?id=DP-0001', { method: 'DELETE' }));
  assert.equal(deleted.status, 400);
  assert.match((await deleted.json()).error, /member enrollments/i);
});

test('master-data CRUD blocks deleting assigned branches', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  const crud = h.load('lib/master-data-crud.ts');
  h.rows.Branches = [[], ['BR-0001', 'MATINA', 'METRO DAVAO 1']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-0001']];
  await h.sync();
  await assert.rejects(() => crud.deleteBranchRecord('BR-0001'), /assigned/i);
});

test('member directory requires Members page access, joins accounts once, and filters the same enrollment', async () => {
  const h = harness(null);
  const route = h.load('app/api/members/directory/route.ts');
  const directory = (query = '') => route.GET(new Request(`http://localhost/api/members/directory${query}`));
  assert.equal((await directory()).status, 403);
  h.setUser({ userId: 'U2', roleNames: ['HR Officer'], permissions: {}, rolePages: { 'hr officer': ['/employees'] } });
  assert.equal((await directory()).status, 403, 'a role without the Members page cannot pull the directory');
  // Finance sees every member but does not encode; a MAS sees only their own (tested separately).
  h.setUser({ userId: 'U1', roleNames: ['Finance'], permissions: {} });
  await seed('members', [
    { member_id: 'M1', member_number: 'PH-001', surname: 'Santos', first_name: 'Ana', address: 'Blk 12, Mintal, Davao City', claimant_name: 'Pedro Santos', claimant_same_address: true, status: 'Active' },
    { member_id: 'M2', member_number: 'PH-002', surname: 'Cruz', first_name: 'Ben' },
  ]);
  await seed('programs', [{ program_id: 'P1', program_code: 'A', program_name: 'Program A' }, { program_id: 'P2', program_code: 'B', program_name: 'Program B' }]);
  await seed('member_programs', [
    { enrollment_id: 'E1', member_id: 'M1', member_number: 'PH-001', program_id: 'P1', doi: '2026-01-01', branch: 'North', mas: 'MAS1' },
    { enrollment_id: 'E2', member_id: 'M1', member_number: 'PH-001', program_id: 'P2', doi: '2026-02-01', branch: 'South', mas: 'MAS2' },
  ]);
  const response = await directory();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const { members, canAddMember, total, matched, pages, counts, options } = await response.json();
  assert.deepEqual([total, matched, pages, counts[''], counts.active], [2, 2, 1, 2, 1]);
  assert.deepEqual(options.branches, ['North', 'South']);
  // The server applies the filters, matching branch, MAS and program on the same enrollment.
  const ids = async (query) => (await (await directory(query)).json()).members.map((member) => member.id);
  assert.deepEqual(await ids('?branch=North&program=P2'), []);
  assert.deepEqual(await ids('?branch=South&mas=MAS2&program=P2'), ['M1']);
  assert.deepEqual(await ids('?search=ana%20santos'), ['M1']);
  assert.deepEqual(await ids('?sort=number&order=desc'), ['M2', 'M1']);
  assert.equal(canAddMember, false, 'only encoders are offered Add Member (New Sales)');
  assert.equal(members.length, 2);
  const ana = members.find((m) => m.id === 'M1');
  assert.equal(ana.enrollments.length, 2);
  assert.equal(ana.address, 'Blk 12, Mintal, Davao City');
  assert.equal(ana.claimantAddress, ana.address);
  assert.equal(ana.claimant, 'Pedro Santos');
  assert.equal(ana.status, 'Active');
  const { filterMemberDirectory, emptyDirectoryFilters, buildMemberDirectory } = h.load('lib/member-directory.ts');
  const filter = (values) => filterMemberDirectory(members, { ...emptyDirectoryFilters, ...values });
  assert.equal(filter({ branch: 'North', program: 'P2' }).length, 0);
  assert.equal(filter({ branch: 'South', mas: 'MAS2', program: 'P2' }).length, 1);
  ana.enrollments[0].accountStatus = 'U';
  ana.enrollments[1].accountStatus = '60D';
  ana.enrollments[1].temporarilySuspended = true;
  assert.equal(filter({ program: 'P1', accountStatus: '60D' }).length, 0);
  assert.equal(filter({ program: 'P2', accountStatus: '60D' }).length, 1);
  assert.equal(filter({ accountStatus: 'Suspended' }).length, 1);
  assert.equal(filter({ search: 'ana santos' }).length, 1);
  assert.equal(filter({ search: 'PH-002' })[0].enrollments.length, 0);
  assert.equal(filter({ status: 'Active', city: 'City', province: 'Province' }).length, 1);
  const record = { id: 'M1', number: 'PH-001', surname: 'Santos', firstName: 'Ana', middleName: '', nameExtension: '', birthdate: '', birthplace: '', gender: '', civilStatus: '', contact: '', address: '', status: '', claimant: '', claimantContact: '', claimantSameAddress: false, claimantAddress: '' };
  assert.throws(() => buildMemberDirectory([record, record], [], {}), /Duplicate member ID/);
  assert.equal(h.writes.length, 0);
});

test('attendance tracking lets Finance review one employee across a date range', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'finance', roleNames: ['Finance'], permissions: {} });
  h.rows.Employees = [[], ['MD-2099-0101', 'Ana Santos', 'MATINA', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-2099-0101', 'BR-1']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  const attendance = Array(18).fill(''); attendance[0] = 'ATT-1'; attendance[1] = 'MD-2099-0101'; attendance[2] = '2026-09-15'; attendance[3] = 'MATINA'; attendance[6] = '08:05:00'; attendance[7] = '17:00:00'; attendance[8] = 8.92; attendance[9] = 0; attendance[10] = 'Present'; attendance[11] = 5;
  h.rows.Attendance = [[], attendance];
  const route = h.load('app/api/attendance-tracking/route.ts');
  const response = await route.GET(new Request('http://localhost/api/attendance-tracking?from=2026-09-01&to=2026-09-30&employeeId=MD-2099-0101'));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.employees[0].branches[0], 'MATINA · METRO DAVAO 1');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].lateMinutes, 5);
});

test('all mutation routes reject unauthenticated requests before writing', async () => {
  const h = harness(null);
  for (const route of ['sales', 'collections', 'remittances', 'branches', 'programs', 'program-incentives', 'user-accounts', 'attendance', 'attendance-reviews', 'leave-requests', 'leave-approvals', 'finance-options', 'vendor-payables', 'commissions']) {
    assert.equal((await h.load(`app/api/${route}/route.ts`).POST(request())).status, 401, route);
  }
  assert.equal(h.writes.length, 0);
});

for (const existingMember of [false, true]) {
  test(`sales track every related row (${existingMember ? 'existing' : 'new'} member), ignore spoofed identity`, async () => {
    const h = harness();
    h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
    h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
    h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
    h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
    h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
    await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
    if (existingMember) await seed('members', [{ member_id: 'MEM-1', member_number: 'PH-1', surname: 'Old', first_name: 'Name' }]);
    const response = await h.load('app/api/sales/route.ts').POST(request({
      branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 350,
      encodedBy: 'attacker', userId: 'attacker',
      sales: [{ existingMember, memberNumber: existingMember ? 'PH-1' : '', programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', addressHouse: 'Complete Address', encodedBy: 'attacker', beneficiaries: existingMember ? [] : [{ surname: 'Santos', firstName: 'Ben', middleName: '', birthdate: '2000-01-02', age: 26, relationship: 'Child' }] }],
    }));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    const [member] = await query('select * from members');
    assert.equal(await count('members'), 1, 'an existing member is never registered again');
    // An existing member's record takes the details confirmed on the sale; blanks keep what is on record.
    assert.equal(member.address, 'Complete Address');
    assert.deepEqual([member.surname, member.first_name], existingMember ? ['Old', 'Name'] : ['', '']);
    if (existingMember) assert.deepEqual(await query("select action, table_name, record_id, employee_id from audit_log"), [{ action: 'update', table_name: 'members', record_id: 'MEM-1', employee_id: 'DPE-0001' }], 'the correction is in the Audit Log');
    else assert.equal(member.status, 'Active');
    // Every row the sale created carries the signed-in encoder and one timestamp, whatever the request body claims.
    const created = [...await query('select * from member_programs'), ...await query('select * from sales'), ...await query('select * from beneficiaries'), ...(existingMember ? [] : [member])];
    assert.equal(created.length, existingMember ? 2 : 4);
    for (const row of created) {
      assert.deepEqual([row.encoded_by_user_id, row.encoded_by_employee_id, row.encoded_by_name], ['USR-1', 'DPE-0001', '=encoder']);
      assert.equal(new Date(row.encoded_at).getTime(), new Date(created[0].encoded_at).getTime());
    }
    // A new sale is cash the MAS owes until a New Sales remittance covers it (no penalty, no Fidelity on this batch).
    // No registration fee: the month-1 MAS tier on the ₱350 base pay (₱50 mark-up, 50%) leaves ₱150 incentive, ₱200 owed.
    const [sale] = await query('select * from sales');
    assert.deepEqual([sale.remittance_status, sale.linked_remittance_id, sale.accountable_employee_id, sale.penalty_amount, sale.penalty_note, Number(sale.mas_incentive), Number(sale.remittance_amount), sale.fidelity_amount],
      ['Outstanding', null, 'DPE-0002', null, null, 150, 200, null]);
    assert.deepEqual([sale.address, sale.program_id, sale.application_no], ['Complete Address', 'DP-1', 'APP-1']);
    assert.equal((await query('select account_status from member_programs'))[0].account_status, 'NS', 'a new account starts as a New Sale');
    if (!existingMember) {
      const [beneficiary] = await query('select * from beneficiaries');
      assert.match(beneficiary.beneficiary_id, /^BEN-/);
      assert.match(beneficiary.member_id, /^MEM-/);
      assert.match(beneficiary.sale_id, /^SALE-/);
      assert.deepEqual([beneficiary.surname, beneficiary.first_name, beneficiary.middle_name, beneficiary.birthdate?.toISOString().slice(0, 10), beneficiary.age, beneficiary.relationship], ['Santos', 'Ben', null, '2000-01-02', 26, 'Child']);
    }
  });
}

test('collection batch is encoded atomically without creating a remittance', async () => {
  const h = harness();
  const today = h.load('lib/account-rules.ts').todayInManila();
  const month = today.slice(0, 7);
  const next = h.load('lib/account-rules.ts').monthName(h.load('lib/account-rules.ts').monthIndex(month) + 1);
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  await seedAccount({ doi: month + '-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('program_incentives', [
    { incentive_id: 'I1', program_id: 'DP-1', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 },
    { incentive_id: 'I2', program_id: 'DP-1', role: 'Collector', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 20 },
  ]);
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active'], ['PMT-GCASH', 'GCash', false, true, 'active']];
  // The New Sale is NOP 1 (DOI month), so the first collection is NOP 2 for the following month.
  const afterNext = h.load('lib/account-rules.ts').monthName(h.load('lib/account-rules.ts').monthIndex(month) + 2);
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: 'OR-1', orDate: today };
  const batch = { branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'DTO', paymentMethod: 'GCash', paymentReference: 'GC-778899', controlTotal: 700, collections: [entry, { ...entry, monthFrom: afterNext, monthTo: afterNext, nopFrom: 3, nopTo: 3, orNumber: 'OR-2' }] };
  const route = h.load('app/api/collections/route.ts');
  assert.match((await (await route.POST(request({ ...batch, paymentReference: '' }))).json()).message, /GCash reference number/);
  assert.match((await (await route.POST(request({ ...batch, autoApproveRemittance: true, cashReceived: 400 }))).json()).message, /verified in Remittances/);
  // A remittance penalty needs a note saying what it is for.
  assert.match((await (await route.POST(request({ ...batch, penalty: 50, penaltyNote: '' }))).json()).message, /what the penalty is for/);
  assert.match((await (await route.POST(request({ ...batch, penalty: -5, penaltyNote: 'x' }))).json()).message, /zero or a positive/);
  // Fidelity is the employee's own money: no limit and any batch (covered by the Fidelity tests below).
  assert.equal((await query('select count(*)::int as n from collections'))[0].n, 0, 'rejected batches save nothing');
  const response = await route.POST(request({ ...batch, collectedBy: 'Collector', originalMasOfficerName: 'ignored', penalty: 50, penaltyNote: 'Late turnover' }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  const written = await query('select * from collections order by or_number');
  assert.equal(written.length, 2);
  assert.deepEqual(written.map((row) => row.collection_id).sort(), [...result.collectionIds].sort());
  // The penalty is stored once, on the batch's first row, so a remittance counts it exactly once.
  assert.deepEqual(written.map((row) => [row.penalty_amount === null ? null : Number(row.penalty_amount), row.penalty_note]), [[50, 'Late turnover'], [null, null]]);
  // Collector batches record the batch MAS as the original MAS; no separate field is asked for.
  assert.deepEqual(written.map((row) => row.original_mas), ['MAS-2', 'MAS-2']);
  assert.match(written[0].collection_batch_id, /^CBT-/);
  const tiers = [{ role: 'Collector', fromMonth: 1, toMonth: 999, incentiveType: 'percentage', markUp: 50, incentiveAmount: 20 }];
  for (const row of written) {
    assert.deepEqual([row.encoded_by_user_id, row.encoded_by_employee_id, row.encoded_by_name], ['USR-1', 'DPE-0001', '=encoder'], 'the signed-in encoder, never the request body');
    assert.equal(row.collection_batch_id, written[0].collection_batch_id);
    assert.equal(row.remittance_status, 'Outstanding');
    assert.equal(row.linked_remittance_id, null);
    assert.equal(row.accountable_employee_id, 'DPE-0002');
    assert.equal(row.collected_by_role, 'Collector');
    assert.equal(Number(row.remittance_amount), h.load('lib/remittance.ts').calculateRemittance(350, tiers, 'Collector', row.nop_from, row.nop_to, 350).remittance, 'Collector tier applies');
    assert.deepEqual([row.remittance_method, row.payment_reference], ['GCash', 'GC-778899']);
  }
  assert.equal((await query("select account_status from member_programs where enrollment_id = 'ENR-1'"))[0].account_status, 'ADV');
  // The status change is in the Audit Log with the signed-in user, written by the database itself.
  assert.deepEqual(await query('select action, table_name, record_id, employee_id from audit_log'), [{ action: 'update', table_name: 'member_programs', record_id: 'ENR-1', employee_id: 'DPE-0001' }]);
  // Paying the same months again is refused against the saved payments.
  assert.equal((await route.POST(request({ ...batch, collections: [{ ...entry, orNumber: 'OR-3' }], controlTotal: 350 }))).status, 400);
  assert.equal(result.remittanceId, undefined);
  assert.equal(result.grossCollection, 700);
  assert.match(result.message, /₱50.00 penalty/);
});

test('collection member search matches branch and MAS and returns eligible programs', async () => {
  const h = harness();
  await seed('members', [{ member_id: 'M1', member_number: 'PH-001', surname: 'Santos', first_name: 'Ana' }, { member_id: 'M2', member_number: 'PH-002', surname: 'Santos', first_name: 'Ana Two' }]);
  await seed('programs', ['P1', 'P2', 'P3', 'P4'].map((program_id) => ({ program_id, program_name: program_id })));
  const enrollment = (enrollment_id, member_id, member_number, program_id, branch, mas) => ({ enrollment_id, member_id, member_number, program_id, branch, mas, status: 'Active' });
  await seed('member_programs', [
    enrollment('E1', 'M1', 'PH-001', 'P1', 'North', 'MAS One'), enrollment('E2', 'M1', 'PH-001', 'P2', 'North', 'MAS One'),
    enrollment('E3', 'M2', 'PH-002', 'P3', 'South', 'MAS One'), enrollment('E4', 'M2', 'PH-002', 'P4', 'North', 'MAS Two'),
  ]);
  const results = await h.load('lib/member-records.ts').searchMembersByName('ana', 'North', 'MAS One');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'M1');
  assert.deepEqual(results[0].programIds, ['P1', 'P2']);
  // The full list for a Branch and MAS: each member with only their own programs there, and no one else's members.
  await seed('members', [{ member_id: 'M3', member_number: 'PH-003', surname: 'Lim', first_name: 'Joy' }]);
  await seed('member_programs', [{ enrollment_id: 'E5', member_id: 'M3', member_number: 'PH-003', program_id: 'P3', branch: 'North', mas: 'MAS One', status: 'Active' }]);
  const list = await h.load('lib/member-records.ts').listMembersForMas('North', 'MAS One');
  assert.deepEqual(list.map((member) => [member.id, member.programIds]).sort(), [['M1', ['P1', 'P2']], ['M3', ['P3']]], 'one program is auto-selected for M3; M2 is not under this MAS');
});

test('physical remittance links exact outstanding collections and records a discrepancy', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 200; collection[28] = 'Outstanding'; collection[30] = 'DPE-0002'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const response = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-1'], actualAmount: 340, remittanceDate: '2026-09-26', remittanceTime: '09:00', receivedByName: 'Cashier' }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.status, 'Discrepancy');
  assert.equal(result.remittance.expectedAmount, 200);
  assert.equal(result.remittance.difference, 140);
  const requests = h.writes[0].requestBody.requests;
  const remittance = requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(remittance[4], 'Discrepancy');
  assert.deepEqual(remittance.slice(10, 13), [200, 340, 140]);
  const mapping = requests[1].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(mapping[1], result.remittance.id);
  assert.equal(mapping[2], 'COL-1');
  assert.equal(mapping[3], 200);
  const status = requests[2].updateCells.rows[0].values.map((value) => value.userEnteredValue.stringValue);
  assert.deepEqual(status, ['Pending Remittance Approval', result.remittance.id]);
});

test('pending approval does not clear cash accountability', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[6] = 'BR-1'; collection[10] = 350; collection[19] = 'Posted'; collection[26] = 200; collection[28] = 'Pending Remittance Approval'; collection[29] = 'REM-1'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  const remittance = Array(24).fill(''); remittance[0] = 'REM-1'; remittance[1] = 'BR-1'; remittance[2] = 'Maria'; remittance[4] = 'Pending Approval'; remittance[10] = 350; remittance[11] = 350; remittance[13] = 'DPE-2'; remittance[14] = 'MAS'; remittance[15] = 1;
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Remittances = [remittancesHeader, remittance];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At'], ['RCL-1', 'REM-1', 'COL-1', 350]];
  deadlineHeaders(h);
  await h.sync();
  const dashboard = await h.load('lib/remittance-workflow.ts').getRemittanceDashboard();
  assert.equal(dashboard.summary.outstandingAmount, 200);
  assert.equal(dashboard.summary.pendingAmount, 350);
  assert.equal(dashboard.outstanding.length, 0);
  assert.equal(dashboard.accountability[0].outstandingAmount, 200);
});

test('administrator who is also an Entry Clerk may approve own remittance', async () => {
  const h = harness({ userId: 'USR-1', employeeId: 'DPE-1', name: 'admin', roleNames: ['Administrator', 'Entry Clerk'], permissions: { manageUsers: true } });
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[10] = 350; collection[19] = 'Posted'; collection[28] = 'Pending Remittance Approval'; collection[29] = 'REM-1';
  const remittance = Array(24).fill(''); remittance[0] = 'REM-1'; remittance[4] = 'Pending Approval'; remittance[6] = 'USR-1'; remittance[10] = 350; remittance[11] = 350;
  const collectionHeader = Array(33).fill(''); collectionHeader[28] = 'Remittance Status';
  const remittanceHeader = Array(24).fill(''); remittanceHeader[12] = 'Difference';
  h.rows.Collections = [collectionHeader, collection];
  h.rows.Remittances = [remittanceHeader, remittance];
  h.rows['Remittance Collections'] = [['Remittance Collection ID'], ['RCL-1', 'REM-1', 'COL-1', 350]];
  deadlineHeaders(h);
  const route = h.load('app/api/remittances/route.ts');
  assert.match((await (await route.PATCH(request({ remittanceId: 'REM-1', decision: 'approve' }))).json()).error, /Attach the receipt photo before approval .*COL-1/, 'no approval without the receipt photo');
  h.rows['Receipt Photos'] = [[], ['RCP-1', 'COL-1']];
  h.clearCache?.();
  const response = await route.PATCH(request({ remittanceId: 'REM-1', decision: 'approve' }));
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
});

test('only an approver can approve cash received in full, and it does not wait for receipt photos', async () => {
  const h = harness({ userId: 'USR-7', employeeId: 'MD-2099-0102', name: 'Test Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[6] = 'MINTAL'; collection[10] = 350; collection[19] = 'Posted'; collection[26] = 300; collection[28] = 'Outstanding'; collection[30] = 'EMP-1'; collection[31] = 'Ana'; collection[32] = 'Collector';
  const collectionHeader = Array(33).fill(''); collectionHeader[28] = 'Remittance Status';
  const remittanceHeader = Array(25).fill(''); remittanceHeader[12] = 'Difference';
  h.rows.Collections = [collectionHeader, collection];
  h.rows.Remittances = [remittanceHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID']];
  deadlineHeaders(h);
  const route = h.load('app/api/remittances/route.ts');
  // An Entry Clerk's entries reach approval on their own; approving cash at once is for approvers.
  assert.equal((await route.POST(request({ collectionIds: ['COL-1'], actualAmount: 300, remittanceDate: '2026-09-28', remittanceTime: '09:00', cashConfirmed: true }))).status, 403);
  h.setUser({ userId: 'USR-7', employeeId: 'MD-2099-0102', name: 'Test Clerk', roleNames: ['Administrator', 'Entry Clerk'], permissions: { manageUsers: true } });
  // No receipt photo yet: cash received in full is approved at once, and the photo is attached later.
  const short = await route.POST(request({ collectionIds: ['COL-1'], actualAmount: 299, remittanceDate: '2026-09-28', remittanceTime: '09:00', cashConfirmed: true }));
  assert.equal(short.status, 400);
  const response = await route.POST(request({ collectionIds: ['COL-1'], actualAmount: 300, remittanceDate: '2026-09-28', remittanceTime: '09:00', cashConfirmed: true }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.status, 'Approved');
  const requests = h.writes.at(-1).requestBody.requests;
  const row = requests[0].appendCells.rows[0].values.map((cell) => cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue);
  assert.equal(row[4], 'Approved');
  assert.deepEqual(row.slice(18, 21), ['USR-7', 'MD-2099-0102', 'Test Clerk']);
  assert.match(row[23], /Cash received in full/);
  assert.equal(requests.at(-1).updateCells.rows[0].values[0].userEnteredValue.stringValue, 'Remitted');
});

test('sign-in looks up the active account by Employee ID and reads configured role pages', async () => {
  const h = harness();
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-3', 'MD-2099-0102', 'Test Clerk', 'hash', 'active', '', 'ROLE-FINANCE']];
  h.rows.Roles = [[], ['ROLE-FINANCE', 'Finance', '', false, false, false, 'active', '', '', '', '', '/remittances, /expenses']];
  h.rows['User Roles'] = [[], ['USR-3', 'ROLE-FINANCE']];
  const { getLoginUserByEmployeeId } = h.load('lib/google-sheets-data.ts');
  const user = await getLoginUserByEmployeeId('md-2099-0102');
  assert.equal(user.fullName, 'Test Clerk');
  assert.deepEqual(user.roles[0].pages, ['/remittances', '/expenses']);
  assert.equal(await getLoginUserByEmployeeId('april'), null);
});

test('user accounts accept company-format Employee IDs and number new user IDs', async () => {
  const h = harness({ userId: 'USR-1', employeeId: 'MD-2099-0001', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-0004', 'MD-2099-0001', 'Admin', 'x', 'active', '', 'ROLE-ADMINISTRATOR']];
  h.rows.Roles = [[], ['ROLE-FINANCE', 'Finance', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['MD-2099-0103', 'New Staff', 'MATINA', 'Finance', 'active']];
  const { createEmployeeAccount } = h.load('lib/google-sheets-data.ts');
  await assert.rejects(h.load('lib/encoder-context.ts').withEncoder(async () => { await createEmployeeAccount({ employeeId: 'MD-99-1', fullName: 'Bad', passwordHash: 'x', roleIds: ['ROLE-FINANCE'] }); return Response.json({}); })(request()), /company format MD-20##-####/);
  const created = await h.load('lib/encoder-context.ts').withEncoder(async () => Response.json(await createEmployeeAccount({ employeeId: 'md-2099-0103', fullName: 'New Staff', passwordHash: 'x', roleIds: ['ROLE-FINANCE'] })))(request());
  const account = await created.json();
  assert.equal(account.employeeId, 'MD-2099-0103');
  assert.equal(account.id, 'USR-0005');
});

test('form buttons declare a type because the Base UI Button defaults to type="button"', () => {
  const files = [];
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else if (full.endsWith('.tsx')) files.push(full);
  });
  ['app', 'components'].forEach(walk);
  const offenders = files.flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/<Button\b(?:[^>]|=>)*?>/g)]
    .map((match) => match[0])
    .filter((tag) => !/\btype=/.test(tag) && !/\bonClick=/.test(tag) && !/\brender=/.test(tag))
    .map((tag) => `${file}: ${tag}`));
  assert.deepEqual(offenders, [], 'A submit <Button> needs type="submit"; other buttons need type="button" or onClick.');
});

test('payroll run is calculated from pay setup, attendance, and pending commissions', async () => {
  const h = harness({ userId: 'USR-1', employeeId: 'MD-2099-0001', name: 'Finance User', roleNames: ['Finance'], permissions: {} });
  h.rows.Employees = [[], ['MD-2099-0010', 'Office Staff', 'BR-1', 'Entry Clerk', 'active'], ['MD-2099-0011', 'Field MAS', 'BR-1', 'MAS', 'active'], ['MD-2099-0012', 'No Setup', 'BR-1', 'HR Officer', 'active']];
  h.rows['Employee Branches'] = [[]];
  h.rows['Pay Profiles'] = [[], ['MD-2099-0010', 'daily', 800, false, 8, 1.25, 'active', '', ''], ['MD-2099-0011', 'none', 0, true, 8, 1.25, 'active', '', '']];
  const attendance = (date, status, ot = 0) => { const row = Array(18).fill(''); row[0] = `ATT-${date}`; row[1] = 'MD-2099-0010'; row[2] = date; row[9] = ot; row[10] = status; return row; };
  h.rows.Attendance = [[], attendance('2099-09-01', 'Present', 2), attendance('2099-09-02', 'Present'), attendance('2099-09-03', 'Absent')];
  h.rows.Commissions = [[], ['COM-1', 'MD-2099-0011', 'Field MAS', '2099-09-01', '2099-09-15', 5000, 500, 4500, 'Pending', '', '', ''], ['COM-2', 'MD-2099-0011', 'Field MAS', '2099-08-01', '2099-08-15', 100, 0, 100, 'Paid', '', '', '']];
  h.rows.Collections = [[]];
  h.rows['Payroll Runs'] = [[]]; h.rows['Payroll Lines'] = [[]]; h.rows['Payroll Adjustments'] = [[]];
  const route = h.load('app/api/payroll/route.ts');
  const post = (body) => route.POST(new Request('http://localhost/api/payroll', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  const response = await post({ action: 'create', periodFrom: '2099-09-01', periodTo: '2099-09-15' });
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.deepEqual(result.missingProfiles, ['No Setup']);
  const appended = h.writes.filter((write) => write.range?.startsWith("'Payroll"));
  const runRow = appended.find((write) => write.range.startsWith("'Payroll Runs'")).requestBody.values[0];
  assert.equal(runRow[4], 'Draft');
  assert.equal(runRow[9], 6350); // staff: 2 days × 800 + 2h OT 250 = 1850; MAS: pending commission 4500 (the paid one is excluded)
  const lines = appended.find((write) => write.range.startsWith("'Payroll Lines'")).requestBody.values;
  const staff = lines.find((row) => row[2] === 'MD-2099-0010'), mas = lines.find((row) => row[2] === 'MD-2099-0011');
  assert.equal(staff[12], 1600);
  assert.equal(staff[14], 250);
  assert.equal(mas[20], 4500);
  assert.equal(mas[21], 'COM-1');
  const denied = await (await route.POST(new Request('http://localhost/api/payroll', { method: 'POST', body: JSON.stringify({ action: 'create' }) }))).json();
  assert.match(denied.message, /valid pay period/);

  // Additions and deductions: categories belong to their kind, and a company-program deduction names the program.
  h.rows['Payroll Runs'] = [[], runRow]; h.rows['Payroll Lines'] = [[], ...lines];
  h.rows.Programs = [[], ['DP-0001', 'P1', 'Plan One', 350, 'active', '']];
  const adjust = async (body) => { const res = await post({ action: 'addAdjustment', runId: result.id, employeeId: 'MD-2099-0010', amount: 350, reason: 'Program contribution, September', ...body }); return { status: res.status, body: await res.json() }; };
  assert.match((await adjust({ kind: 'Addition', category: 'SSS contribution' })).body.message, /addition category/);
  assert.match((await adjust({ kind: 'Deduction', category: 'Company program' })).body.message, /company program/);
  assert.match((await adjust({ kind: 'Deduction', category: 'SSS contribution', reason: '' })).body.message, /reason/);
  const program = await adjust({ kind: 'Deduction', category: 'Company program', programId: 'DP-0001' });
  assert.equal(program.status, 201, JSON.stringify(program.body));
  const saved = h.writes.filter((write) => write.range?.startsWith("'Payroll Adjustments'")).at(-1).requestBody.values[0];
  assert.deepEqual(saved.slice(2, 8), ['MD-2099-0010', 'Deduction', 'Company program', 350, 'P1 - Plan One: Program contribution, September', 'active']);
  assert.equal((await adjust({ kind: 'Addition', category: '13th month pay', reason: 'Pro-rated 13th month' })).status, 201);
});

test('password change verifies the current password and writes only the hash cell', async () => {
  const bcrypt = require('bcryptjs');
  const h = harness({ userId: 'USR-3', employeeId: 'MD-2099-0102', name: 'Test Clerk', roleNames: ['Finance'], permissions: {} });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-1', 'MD-2099-0001', 'Other', 'x', 'active', '', ''], ['USR-3', 'MD-2099-0102', 'Test Clerk', await bcrypt.hash('current-password-1', 4), 'active', '', 'ROLE-FINANCE']];
  const route = h.load('app/api/settings/route.ts');
  const patch = (body) => route.PATCH(new Request('http://localhost/api/settings', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await patch({ currentPassword: 'wrong', newPassword: 'a-new-password-2' })).status, 400);
  const response = await patch({ currentPassword: 'current-password-1', newPassword: 'a-new-password-2' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const write = h.writes.at(-1);
  assert.equal(write.range, 'Users!D3');
  assert.ok(await bcrypt.compare('a-new-password-2', write.requestBody.values[0][0]));
  // This device gets a session for the new password, without the change-password lock.
  const cookie = response.headers.get('Set-Cookie');
  assert.match(cookie, /^dayong_session=[^;]+; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Lax/);
  const session = await h.load('lib/auth.ts').verifySessionToken(cookie.split(';')[0].split('=')[1]);
  assert.equal(session.mustChangePassword, false);
  assert.equal(session.passwordStamp, h.load('lib/session-account.ts').passwordStamp(write.requestBody.values[0][0]));
  assert.equal((await patch({ currentPassword: 'a-new-password-2', newPassword: 'password12345' })).status, 400, 'the default password is never accepted as a new one');
});

test('HR registering an employee creates the account without seeing its one-time password', async () => {
  const h = harness({ userId: 'U9', employeeId: 'DPE-0009', name: 'hr', roleNames: ['HR Officer'], permissions: {} });
  const route = h.load('app/api/employees/route.ts');
  h.rows.Employees = [[]];
  h.rows.Users = [[]];
  h.rows.Branches = [[], ['BR-1', 'South', 'DDO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Roles = [[], ['R1', 'MAS', '', '', '', '', 'active']];
  const response = await route.POST(request({ employeeId: 'MD-2099-0201', name: 'New Staff', branchIds: ['BR-1'], roles: ['MAS'] }));
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).account, { created: true });
});

test('IT resets a forgotten password to a one-time password that expires and must be changed', async () => {
  const header = ['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'];
  const h = harness({ userId: 'U7', employeeId: 'DPE-0007', name: 'it', roleNames: ['IT Clerk'], permissions: {} });
  h.rows.Users = [header, ['USR-3', 'MD-2099-0102', 'Test Clerk', 'old-hash', 'active', '', 'R1'], ['USR-4', 'MD-2099-0103', 'Gone', 'x', 'inactive', '', 'R1']];
  h.rows.Roles = [[], ['R1', 'Entry Clerk', '', '', '', '', 'active']];
  h.rows['User Roles'] = [[], ['USR-3', 'R1']];
  const route = h.load('app/api/user-accounts/password/route.ts');
  const reset = (id) => route.POST(new Request('http://localhost/api/user-accounts/password', { method: 'POST', body: JSON.stringify({ id }), headers: { 'Content-Type': 'application/json' } }));
  const response = await reset('USR-3');
  assert.equal(response.status, 200);
  const { account } = await response.json();
  const stored = h.writes.at(-1);
  assert.equal(stored.range, 'Users!D2', 'only the password cell changes');
  const passwords = h.load('lib/passwords.ts');
  assert.deepEqual(await passwords.checkPassword(account.oneTimePassword, stored.requestBody.values[0][0]), { matches: true, oneTime: true, expired: false });
  const later = Date.now() + (passwords.ONE_TIME_PASSWORD_HOURS * 60 + 1) * 60 * 1000;
  assert.equal((await passwords.checkPassword(account.oneTimePassword, stored.requestBody.values[0][0], later)).expired, true);
  assert.equal((await reset('USR-4')).status, 400, 'an inactive account is reactivated before its password is reset');
  h.setUser({ userId: 'U8', employeeId: 'DPE-0008', name: 'clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await reset('USR-3')).status, 403, 'only IT or an administrator issues one-time passwords');
});

test('New Sales searches every member; Collections stays within its branch and MAS', async () => {
  const h = harness();
  const route = h.load('app/api/members/route.ts');
  await seed('members', [{ member_id: 'M1', member_number: 'PH-001', surname: 'Santos', first_name: 'Ana' }, { member_id: 'M2', member_number: 'PH-002', surname: 'Santos', first_name: 'Ben' }]);
  await seed('programs', [{ program_id: 'P1', program_name: 'P1' }]);
  await seed('member_programs', [{ enrollment_id: 'E1', member_id: 'M1', member_number: 'PH-001', program_id: 'P1', doi: '2026-01-01', branch: 'North', mas: 'MAS1' }]);
  const search = async (query) => (await (await route.GET(new Request(`http://localhost/api/members?${query}`))).json()).members.map((member) => member.id);
  assert.deepEqual(await search('search=santos'), ['M1', 'M2']);
  assert.deepEqual(await search('search=santos&branch=North&mas=MAS1'), ['M1']);
  assert.deepEqual(await search('search=santos&branch=North'), [], 'a half-scoped search returns nothing');
});

test('New Sales blocks double entries: repeated Application Numbers and members registered again as new', async () => {
  const h = harness();
  await seed('programs', [{ program_id: 'DP-1', program_name: 'Plan' }]);
  await seed('sales', [{ sale_id: 'SALE-1', member_number: 'PH-7', program_id: 'DP-1', application_no: 'APP-100' }]);
  await seed('members', [{ member_id: 'MEM-7', member_number: 'PH-7', surname: 'Santos', first_name: 'Ana', middle_name: 'Cruz', birthdate: '1990-05-01' }]);
  const { newSalesDoubleEntry } = h.load('lib/duplicate-entries.ts');
  const sale = (fields) => ({ existingMember: false, surname: 'Reyes', firstName: 'Ben', birthdate: '1991-02-03', applicationNo: 'APP-200', ...fields });
  assert.equal(await newSalesDoubleEntry([sale({})]), '');
  assert.match(await newSalesDoubleEntry([sale({ applicationNo: 'app 100' })]), /Application Number app 100 is already recorded \(sale SALE-1 for member PH-7\)/);
  assert.match(await newSalesDoubleEntry([sale({}), sale({ surname: 'Lim', applicationNo: 'APP-200' })]), /Sale #2: Application Number APP-200 is already used by Sale #1/);
  assert.match(await newSalesDoubleEntry([sale({ surname: ' santos ', firstName: 'ANA', birthdate: '1990-05-01' })]), /already member PH-7\. To add another program, type the surname and select the existing member/);
  assert.equal(await newSalesDoubleEntry([sale({ existingMember: true, memberNumber: 'PH-7', surname: 'Santos', firstName: 'Ana', birthdate: '1990-05-01' })]), '', 'selecting the existing member is the right way to add a program');
  assert.equal(await newSalesDoubleEntry([sale({}), sale({ applicationNo: 'APP-201' })]), '', 'a new member may take several programs in one batch');
});

test('a new member enrolled in two programs in one batch is registered once', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows.Programs = [[], ['DP-1', 'A', 'Plan A', 350, 'active', '', '', '', '', '', 'No', 0, 0], ['DP-2', 'B', 'Plan B', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50], ['INC-2', 'DP-2', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Plan A'], ['DP-2', 'Plan B']], ['DPE-0002', 'mas']);
  const sale = (programId, applicationNo) => ({ existingMember: false, surname: 'Reyes', firstName: 'Ben', birthdate: '1991-02-03', programId, amountPaid: '350', applicationNo, addressHouse: 'Complete Address' });
  const route = h.load('app/api/sales/route.ts');
  const response = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 700, sales: [sale('DP-1', 'APP-1'), sale('DP-2', 'APP-2')] }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(await count('members'), 1, 'one member record');
  assert.equal(await count('member_programs'), 2, 'two program enrollments');
  assert.equal(result.savedSales[0].memberNumber, result.savedSales[1].memberNumber);
  // Saved for real: the same person as a new member again is caught as a returning member.
  const again = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 350, sales: [sale('DP-1', 'APP-3')] }));
  assert.match((await again.json()).message, /Ben Reyes with this birthdate is already member/);
  const other = (applicationNo) => ({ ...sale('DP-1', applicationNo), surname: 'Lim' });
  const repeat = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 700, sales: [other('APP-3'), other('APP-4')] }));
  assert.match((await repeat.json()).message, /Sale #2: This member is already enrolled in this program earlier in this batch/);
});

test('each OR Number is recorded once; a voided collection frees its receipt', async () => {
  const h = harness();
  await seedAccount();
  const collection = (id, or, status, extra = {}) => ({ collection_id: id, collection_batch_id: 'CBT-1', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', or_number: or, amount_collected: 100, status, ...extra });
  await seed('collections', [collection('COL-1', 'OR-500', 'Posted'), collection('COL-2', 'OR-501', 'Voided')]);
  const { recordedOrNumbers, entryKey } = h.load('lib/duplicate-entries.ts');
  const used = await recordedOrNumbers(['or 500', 'OR-501']);
  assert.deepEqual(used.get(entryKey('or 500')), { collectionId: 'COL-1', memberNumber: 'PH-1' });
  assert.equal(used.has(entryKey('OR-501')), false);
  // The database refuses a second posted collection with the same receipt, however it is typed, even from a racing save.
  await assert.rejects(seed('collections', [collection('COL-3', 'or500', 'Posted')]), /collections_or_key_unique/);
  // A voided receipt can be used again, and duplicates that predate the database are kept, flagged.
  await seed('collections', [collection('COL-4', 'OR 501', 'Posted'), collection('COL-5', 'OR-500', 'Posted', { legacy_duplicate: true })]);
});

test('pages granted to a role appear in the section where they belong, not under More', () => {
  const { visibleNavigation } = harness().load('lib/navigation.ts');
  const permissions = { manageUsers: false, manageAttendance: false, viewAttendanceReports: false };
  const titles = (sections) => Object.fromEntries(sections.map((section) => [section.title, section.items.map((item) => item.href)]));
  // CEO / President list the Statement of Account under Reports by default.
  assert.deepEqual(titles(visibleNavigation('CEO', { roleNames: ['CEO'], permissions })).Reports, ['/admin-reports', '/mam', '/soa']);
  // Configured page access: SOA joins Reports, Expenses opens a Finance section, Programs joins Members in Directory.
  const configured = titles(visibleNavigation('President', { roleNames: ['President'], permissions, rolePages: { president: ['/admin-reports', '/members', '/expenses', '/programs', '/attendance'] } }));
  assert.equal(configured.More, undefined);
  assert.deepEqual(configured.Reports, ['/admin-reports']);
  assert.deepEqual(configured.Directory, ['/members', '/programs']);
  assert.deepEqual(configured.Finance, ['/expenses']);
  const withSoa = titles(visibleNavigation('President', { roleNames: ['President'], permissions, rolePages: { president: ['/admin-reports', '/soa'] } }));
  assert.deepEqual(withSoa.Reports, ['/admin-reports', '/soa']);
  // A new section sits before the personal My HR section.
  const order = visibleNavigation('President', { roleNames: ['President'], permissions, rolePages: { president: ['/attendance', '/expenses'] } }).map((section) => section.title);
  assert.ok(order.indexOf('Finance') < order.indexOf('My HR'));
});

test('the default, short, and common passwords must be changed at sign-in', () => {
  const { isWeakPassword, DEFAULT_PASSWORD } = harness().load('lib/default-password.ts');
  assert.equal(isWeakPassword(DEFAULT_PASSWORD), true);
  assert.equal(isWeakPassword('short-pass'), true);
  assert.equal(isWeakPassword('Password123'), true);
  assert.equal(isWeakPassword('a-long-unique-passphrase'), false);
});

test('session recheck ends sessions for deactivated accounts and changed passwords, and refreshes roles', async () => {
  const h = harness();
  const { recheckSession, sessionFor, passwordStamp } = h.load('lib/session-account.ts');
  const header = ['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'];
  h.rows.Users = [header, ['USR-3', 'MD-2099-0102', 'Test Clerk', 'hash-1', 'active', '', '']];
  h.rows.Roles = [[], ['ROLE-1', 'Entry Clerk', '', '', '', '', 'active']];
  h.rows['User Roles'] = [[], ['USR-3', 'ROLE-1']];
  const signedIn = { ...sessionFor({ id: 'USR-3', employeeId: 'MD-2099-0102', fullName: 'Test Clerk', passwordHash: 'hash-1', roles: [] }, true), expiresAt: 2000000000 };
  const current = await recheckSession(signedIn);
  assert.deepEqual(current.roleNames, ['Entry Clerk'], 'roles granted after sign-in apply at the recheck');
  assert.equal(current.mustChangePassword, true, 'the change-password lock survives a recheck');
  assert.equal(current.expiresAt, 2000000000, 'a recheck never extends the session');
  assert.equal(await recheckSession({ ...signedIn, passwordStamp: '' }), null, 'sessions from before rechecks sign in again');
  h.rows.Users = [header, ['USR-3', 'MD-2099-0102', 'Test Clerk', 'hash-2', 'active', '', '']];
  assert.equal(await recheckSession(signedIn), null, 'a password change or reset ends other sessions');
  h.rows.Users = [header, ['USR-3', 'MD-2099-0102', 'Test Clerk', 'hash-1', 'inactive', '', '']];
  assert.equal(await recheckSession(signedIn), null, 'a deactivated account is signed out');
  assert.notEqual(passwordStamp('hash-1'), passwordStamp('hash-2'));
});

test('new Employee IDs follow the most used prefix and the current year, and stay unique', () => {
  const { suggestEmployeeId } = harness().load('lib/employees.ts');
  assert.equal(suggestEmployeeId(['MD-2099-0001', 'MD-2099-0102', 'DPE-0001'], '2099'), 'MD-2099-0103');
  assert.equal(suggestEmployeeId(['MD-2099-0102'], '2100'), 'MD-2100-0001');
  assert.equal(suggestEmployeeId([], '2099'), 'MD-2099-0001');
});

test('attendance updates never touch original encoder cells, even for historical rows', async () => {
  const h = harness();
  const { withEncoder } = h.load('lib/encoder-context.ts');
  const { updateEncodedRow } = h.load('lib/encoder-sheets.ts');
  await withEncoder(async () => {
    await updateEncodedRow({ range: 'Attendance!A5:R5', requestBody: { values: [Array(18).fill('')] } });
    return Response.json({});
  })(request());
  const data = h.writes[0].requestBody.data;
  assert.deepEqual(data.map((item) => item.range), ['Attendance!A5:R5', "'Attendance'!W5:Y5"]);
  assert.deepEqual(data[1].values[0], ["'USR-1", "'DPE-0001", "'=encoder"]);
});

test('missing headers or missing encoder context cannot create untracked entries', async () => {
  const h = harness();
  const { appendEncodedRows } = h.load('lib/encoder-sheets.ts');
  const params = { range: 'Members!A:R', requestBody: { values: [Array(18).fill('')] } };
  await assert.rejects(appendEncodedRows(params), /verified encoder/);
  h.missingHeaders();
  await assert.rejects(h.load('lib/encoder-context.ts').withEncoder(async () => {
    await appendEncodedRows(params);
    return Response.json({});
  })(request()), /headers are missing/);
  assert.equal(h.writes.length, 0);
});

test('concurrent requests keep distinct encoder timestamps and identities', async () => {
  const h = harness();
  const { withEncoder, getEncoder } = h.load('lib/encoder-context.ts');
  const snapshots = [];
  const handler = withEncoder(async () => {
    const actor = getEncoder();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(getEncoder(), actor);
    snapshots.push(actor);
    return Response.json({});
  });
  const first = handler(request());
  h.setUser({ userId: 'USR-2', employeeId: 'DPE-0002', name: 'second' });
  await Promise.all([first, handler(request())]);
  assert.notEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(new Set(snapshots.map((actor) => actor.userId)), new Set(['USR-1', 'USR-2']));
});

test('all configured sheets append tracking after business columns', async () => {
  const h = harness();
  const { encoderSheets, columnName } = h.load('lib/encoder-schema.ts');
  await h.load('lib/encoder-context.ts').withEncoder(async () => {
    for (const schema of encoderSheets) {
      await h.load('lib/encoder-sheets.ts').appendEncodedRows({
        range: `'${schema.title}'!A:${columnName(schema.columns)}`,
        requestBody: { values: [Array(schema.columns).fill('business')] },
      });
      const write = h.writes.at(-1);
      assert.equal(write.range, `'${schema.title}'!A:${columnName(schema.columns + 4 + (schema.title === "Member programs" ? 1 : 0))}`);
      assert.equal(write.requestBody.values[0].length, schema.columns + 4 + (schema.title === "Member programs" ? 1 : 0));
      assert.deepEqual(write.requestBody.values[0].slice(0, schema.columns), Array(schema.columns).fill('business'));
    }
    return Response.json({});
  })(request());
});

test('leave review keeps encoder columns and existing permission checks reject unauthorized users', async () => {
  const h = harness();
  for (const route of ['user-accounts', 'attendance-reviews', 'leave-approvals']) {
    assert.equal((await h.load(`app/api/${route}/route.ts`).POST(request())).status, 403);
  }
  assert.equal(h.writes.length, 0);
  await h.load('lib/encoder-context.ts').withEncoder(async () => {
    await h.load('lib/encoder-sheets.ts').updateEncodedRow({
      range: "'Leave Requests'!A2:K2", requestBody: { values: [Array(11).fill('')] },
    });
    return Response.json({});
  })(request());
  assert.deepEqual(h.writes[0].requestBody.data.map((item) => item.range), ["'Leave Requests'!A2:K2"]);
});


test('MAM month range counts actual receipts once and preserves later advance coverage', () => {
  const h = harness();
  const a = { id: 'E1', memberId: 'M1', memberNumber: 'PH1', programId: 'P1', doi: '2026-09-15', branch: 'B', mas: 'MAS', basePay: 350, storedStatus: 'Forfeited', rowNumber: 2, memberName: 'Member', programName: 'Program' };
  const p = { id: 'C1', enrollmentId: 'E1', orDate: '2026-09-20', orNumber: 'OR1', monthFrom: '2026-09', monthTo: '2026-11', nopFrom: 1, nopTo: 3, amount: 1050, dateRemitted: '2026-09-21', mas: 'MAS' };
  const { buildMamReport, monitoringMonths } = h.load('lib/mam-report.ts');
  const report = buildMamReport({ accounts: [a], payments: [p], sales: [] }, '2026-09', '2026-11', '2027-06-01');
  assert.deepEqual(report.rows[0].periods.map((period) => period.collected), [1050, 0, 0]);
  assert.deepEqual(report.rows[0].periods.map((period) => period.coveredAmount), [350, 350, 350]);
  assert.deepEqual(report.rows[0].periods.map((period) => period.state.status), ['ADV', 'ADV', 'U']);
  assert.throws(() => monitoringMonths('2026-11', '2026-09'), /valid month range/);
  assert.throws(() => monitoringMonths('2000-01', '2026-09'), /120 months/);
  const before = buildMamReport({ accounts: [a], payments: [p], sales: [] }, '2026-08', '2026-08', '2026-09-25');
  assert.equal(before.rows.length, 0);
});

test('MAM future columns are projections and do not include future receipt data', () => {
  const h = harness();
  const a = { id: 'E1', memberId: 'M1', memberNumber: 'PH1', programId: 'P1', doi: '2026-09-15', branch: 'B', mas: 'MAS', basePay: 350, storedStatus: '', rowNumber: 2, memberName: 'Member', programName: 'Program' };
  const p = { id: 'C1', enrollmentId: 'E1', orDate: '2026-10-20', orNumber: 'OR1', monthFrom: '2026-09', monthTo: '2026-10', nopFrom: 1, nopTo: 2, amount: 700, dateRemitted: '', mas: 'MAS' };
  const report = h.load('lib/mam-report.ts').buildMamReport({ accounts: [a], payments: [p], sales: [] }, '2026-09', '2026-10', '2026-09-25');
  assert.equal(report.rows[0].periods[1].projected, true);
  assert.equal(report.rows[0].periods[1].collected, 0);
  assert.equal(report.rows[0].periods[1].state.nop, 1, 'only the New Sale (NOP 1) counts; the future receipt does not');
});

test('operational reports reconcile source transactions without duplicating data', async () => {
  const h = harness();
  const sale = Array(35).fill(''); sale[0] = 'SAL-1'; sale[1] = '2026-09-10'; sale[2] = 'MATINA'; sale[3] = 'Maria'; sale[21] = 'DP-1'; sale[26] = 350; sale[33] = 'Clerk Name';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[5] = 'DP-1'; collection[6] = 'MATINA'; collection[7] = 'Maria'; collection[9] = '2026-09-10'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 200; collection[31] = 'Maria'; collection[32] = 'MAS';
  const expense = Array(17).fill(''); expense[0] = 'EXP-1'; expense[1] = '2026-09-10'; expense[4] = 50; expense[7] = 'MATINA'; expense[11] = 'Posted';
  const remittance = Array(24).fill(''); remittance[0] = 'REM-1'; remittance[1] = 'MATINA'; remittance[3] = '2026-09-10'; remittance[4] = 'Approved'; remittance[11] = 200;
  const deposit = Array(16).fill(''); deposit[0] = 'CSH-1'; deposit[1] = '2026-09-10'; deposit[2] = 'inflow'; deposit[3] = 'Bank Deposit'; deposit[5] = 100; deposit[6] = 'MATINA'; deposit[10] = 'Posted';
  h.rows.Sales = [[], sale]; h.rows.Collections = [[], collection]; h.rows.Programs = [[], ['DP-1', 'P1', 'Program One']]; h.rows.Remittances = [[], remittance]; h.rows.Expenses = [[], expense]; h.rows['Cash Transactions'] = [[], deposit];
  await h.sync();
  const report = await h.load('lib/reports.ts').buildOperationalReport('2026-09-01', '2026-09-30');
  assert.equal(report.summary.accounts, 2);
  assert.equal(report.summary.gross, 700);
  assert.equal(report.summary.incentives, 150);
  assert.equal(report.summary.net, 550);
  assert.equal(report.summary.expenses, 50);
  assert.equal(report.summary.expectedRemittance, 500);
  assert.equal(report.summary.actualRemittance, 200);
  assert.equal(report.summary.deposits, 100);
  assert.equal(report.summary.difference, 300);
  assert.equal(report.collections[0].masCommission, 150);
  assert.equal(report.sales.length, 1);
  assert.equal(report.sales[0].encodedBy, 'Clerk Name', 'report reads the encoder from Sales');
  assert.equal(report.sales[0].programId, 'DP-1');
});

test('account role loading rejects duplicate primary keys', async () => {
  const h = harness();
  h.rows.Roles = [[], ['ROLE-1', 'Administrator', '', true, false, false, 'active'], ['ROLE-1', 'Finance', '', false, false, false, 'active']];
  await assert.rejects(h.load('lib/google-sheets-data.ts').getActiveAccountRoles(), /Duplicate role ID ROLE-1/);
});

test('payslip lists earnings and deductions with reasons and downloads as a valid PDF', () => {
  const { buildPayslip, payslipPdf, payslipFileName } = harness().load('lib/payslip.ts');
  const line = { employeeId: 'MD-2099-0010', employeeName: 'Office Staff (Niño)', roles: 'Entry Clerk', baseType: 'daily', dailyRate: 800, daysPaid: 2, leaveDays: 0, absentDays: 1, basePay: 1600, overtimeHours: 2, overtimePay: 250, lateMinutes: 0, lateDeduction: 0, undertimeMinutes: 0, undertimeDeduction: 0, absenceDeduction: 800, commission: 0, commissionIds: [], earnedIncentive: 0 };
  const adjustments = [
    { id: 'A1', employeeId: 'MD-2099-0010', kind: 'Addition', category: '13th month pay', amount: 500, reason: 'Pro-rated (partial)' },
    { id: 'A2', employeeId: 'MD-2099-0010', kind: 'Deduction', category: 'SSS contribution', amount: 225, reason: 'SSS employee share — September' },
    { id: 'A3', employeeId: 'OTHER', kind: 'Deduction', category: 'Cash advance', amount: 999, reason: 'not this employee' },
  ];
  const slip = buildPayslip({ id: 'PAY-1', periodFrom: '2099-09-01', periodTo: '2099-09-15', payDate: '', status: 'Draft' }, line, adjustments);
  assert.deepEqual(slip.earnings.map((row) => row.label), ['Base pay', 'Overtime', '13th month pay']);
  assert.deepEqual(slip.deductions.map((row) => [row.label, row.amount]), [['Absences', 800], ['SSS contribution', 225]]);
  assert.equal(slip.net, 1325);
  const bytes = payslipPdf(slip);
  const pdf = Buffer.from(bytes).toString('latin1');
  if (process.env.PAYSLIP_OUT) fs.writeFileSync(process.env.PAYSLIP_OUT, bytes);
  assert.match(pdf, /^%PDF-1\.4/);
  assert.match(pdf, /%%EOF\n$/);
  assert.ok(pdf.includes('(Office Staff \\(Ni\u00f1o\\))'), 'escapes parentheses and keeps Latin-1 letters');
  assert.ok(pdf.includes('(SSS employee share - September)'), 'replaces symbols the PDF font lacks');
  assert.ok(pdf.includes('PHP 1,325.00'), 'shows net pay');
  const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
  assert.equal(pdf.slice(xref, xref + 4), 'xref', 'startxref points at the cross-reference table');
  for (const [index, offset] of [...pdf.matchAll(/(\d{10}) 00000 n /g)].map((match) => Number(match[1])).entries()) assert.equal(pdf.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`);
  assert.equal(payslipFileName(slip), 'Payslip-PAY-1-MD-2099-0010.pdf');
});

test('entry history lists every tracked sheet, including records saved before tracking, without password hashes', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const tracked = (columns, values, who = 'Clerk', at = '2026-09-20T01:00:00.000Z') => { const row = Array(columns + 4).fill(''); values.forEach((value, index) => { row[index] = value; }); row[columns + 2] = who; row[columns + 3] = at; return row; };
  h.rows.Sales = [[], tracked(31, ['SAL-1', '', '', '', '', 'PH-1', 'Santos', 'Ana', '', '', '', '', '', '', '', '', 'Blk 1', '', '', '', '', 'DP-1', '', '', '', '', 350, 'note', 'APP-9'])];
  h.rows.Collections = [[], tracked(21, ['COL-1', '', '', '', 'PH-1', 'DP-1', '', '', 'OR-5', '2026-09-20', 350], 'Collector', '2026-09-21T01:00:00.000Z')];
  h.rows['User Roles'] = [[], tracked(2, ['USR-2', 'ROLE-1']), tracked(2, ['USR-2', 'ROLE-2'])];
  h.rows.Users = [[], ['USR-0001', 'DPE-0001', 'Master Admin', '$2b$10$secret-hash', 'active']];
  h.rows['Audit Log'] = [[],
    ['AUD-1', '2026-09-22T01:00:00.000Z', 'Edited', 'Members', 'MEM-1', 2, JSON.stringify({ changes: { member_contact: ['0917', '0999'], status: ['Active', 'Inactive'] } }), 'USR-1', 'DPE-1', 'Clerk One'],
    ['AUD-2', '2026-09-23T01:00:00.000Z', 'Deleted', 'Members', 'MEM-2', 3, JSON.stringify({ headers: [], row: ['MEM-2', 'PH-2', 'Cruz', 'Ben'] }), 'USR-1', 'DPE-1', 'Clerk One']];
  const response = await h.load('app/api/history/route.ts').GET();
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  const sheetCount = h.load('lib/encoder-schema.ts').encoderSheets.length;
  assert.equal(result.modules.length, sheetCount, 'every tracked sheet is a module, even when empty');
  for (const moduleName of ['New Sales', 'Collections', 'Remittances', 'Members', 'Expenses', 'Payroll', 'User Roles', 'Branch Assignments']) assert.ok(result.modules.includes(moduleName), moduleName);
  assert.deepEqual(result.entries.map((entry) => [entry.action, entry.module]), [['Deleted', 'Members'], ['Edited', 'Members'], ['Created', 'Collections'], ['Created', 'New Sales'], ['Created', 'User Roles'], ['Created', 'User Roles'], ['Created', 'User Accounts']]);
  const [deleted, edited] = result.entries;
  assert.equal(edited.detail, 'member contact: 0917 → 0999; status: Active → Inactive');
  assert.equal(edited.encodedBy, 'Clerk One');
  assert.equal(deleted.id, 'MEM-2');
  assert.equal(deleted.detail, 'PH-2 · Ben Cruz');
  assert.equal(deleted.data, null, 'edits and deletes are not correctable from History');
  assert.equal(new Set(result.entries.map((entry) => entry.key)).size, result.entries.length, 'rows without a unique ID still get unique keys');
  const sale = result.entries.find((entry) => entry.module === 'New Sales');
  assert.equal(sale.detail, 'Ana Santos · DP-1 · App APP-9 · ₱350.00');
  assert.deepEqual(sale.data, { applicationNumber: 'APP-9', amountPaid: 350, notes: 'note' });
  const legacy = result.entries.at(-1);
  assert.equal(legacy.id, 'USR-0001');
  assert.equal(legacy.encodedBy, '');
  assert.ok(!JSON.stringify(result).includes('secret-hash'), 'password hashes never leave the server');
});

// A tiny in-memory spreadsheet for the audit log: row ranges, header rows, updates, appends, and row deletes.
function fakeSpreadsheet(tables) {
  const ids = new Map(Object.keys(tables).map((title, index) => [title, index + 1]));
  const titleOf = (id) => [...ids].find(([, value]) => value === id)?.[0];
  const parse = (range) => { const m = /^'((?:[^']|'')+)'!(\d+):(\d+)$/.exec(range) || /^'?((?:[^'!])+)'?!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range); return m; };
  const col = (letters) => [...letters].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
  const writeRange = (range, values) => {
    const m = /^'?((?:[^'!])+)'?!([A-Z]+)(\d+)/.exec(range); const table = tables[m[1]]; const start = col(m[2]), row = Number(m[3]) - 1;
    values.forEach((cells, r) => { table[row + r] ??= []; cells.forEach((value, c) => { table[row + r][start + c] = String(value); }); });
  };
  return { tables, spreadsheets: {
    get: async () => ({ data: { sheets: [...ids].map(([title, sheetId]) => ({ properties: { title, sheetId } })) } }),
    batchUpdate: async ({ requestBody }) => {
      for (const request of requestBody.requests) {
        if (request.addSheet) { const title = request.addSheet.properties.title; tables[title] = []; ids.set(title, ids.size + 1); }
        if (request.deleteDimension) { const { sheetId, startIndex, endIndex } = request.deleteDimension.range; tables[titleOf(sheetId)].splice(startIndex, endIndex - startIndex); }
      }
      return { data: {} };
    },
    values: {
      batchGet: async ({ ranges }) => ({ data: { valueRanges: ranges.map((range) => { const m = parse(range); return { values: [tables[m[1]][Number(m[2]) - 1] ?? []] }; }) } }),
      update: async ({ range, requestBody }) => { writeRange(range, requestBody.values); return { data: {} }; },
      batchUpdate: async ({ requestBody }) => { for (const item of requestBody.data) writeRange(item.range, item.values); return { data: {} }; },
      append: async ({ range, requestBody }) => { const title = /^'((?:[^']|'')+)'/.exec(range)[1]; tables[title].push(...requestBody.values.map((row) => row.map(String))); return { data: {} }; },
    },
  } };
}

test('audit log records edits as before/after, deletes as snapshots, and hides password hashes', async () => {
  const audit = harness().load('lib/audit-log.ts');
  audit.resetAuditSheetCache();
  const book = fakeSpreadsheet({
    Members: [['member_id', 'member_number', 'surname', 'member_contact', 'status'], ['MEM-1', 'PH-1', 'Santos', '0917', 'Active'], ['MEM-2', 'PH-2', 'Cruz', '0918', 'Active']],
    Users: [['user_id', 'employee_id', 'full_name', 'password_hash', 'status'], ['USR-2', 'DPE-2', 'Ana', 'old-hash', 'active']],
  });
  const actor = () => ({ userId: 'USR-1', employeeId: 'DPE-1', name: 'Clerk One' });
  const run = (plan, write) => audit.auditedWrite(book, 'x', plan, actor, write);
  const edit = { spreadsheetId: 'x', requestBody: { valueInputOption: 'RAW', data: [{ range: 'Members!D2', values: [['0999']] }, { range: 'Members!E2', values: [['Inactive']] }] } };
  await run(audit.planValuesBatchUpdate(edit), () => book.spreadsheets.values.batchUpdate(edit));
  // Saving the same value again is not a change and is not logged.
  const same = { spreadsheetId: 'x', range: 'Members!E2', requestBody: { values: [['Inactive']] } };
  await run(audit.planValuesUpdate(same), () => book.spreadsheets.values.update(same));
  const password = { spreadsheetId: 'x', range: 'Users!D2', requestBody: { values: [['new-hash']] } };
  await run(audit.planValuesUpdate(password), () => book.spreadsheets.values.update(password));
  const removal = { spreadsheetId: 'x', requestBody: { requests: [{ deleteDimension: { range: { sheetId: 1, dimension: 'ROWS', startIndex: 2, endIndex: 3 } } }] } };
  await run(audit.planBatchUpdate(book, removal), () => book.spreadsheets.batchUpdate(removal));

  const log = book.tables['Audit Log'];
  assert.deepEqual(log[0], audit.AUDIT_HEADERS);
  assert.equal(log.length, 4, 'header + edit + password edit + delete');
  const [edited, passwordEdit, deleted] = log.slice(1);
  assert.deepEqual([edited[2], edited[3], edited[4], edited[5]], ['Edited', 'Members', 'MEM-1', '2']);
  assert.deepEqual(JSON.parse(edited[6]), { changes: { member_contact: ['0917', '0999'], status: ['Active', 'Inactive'] } });
  assert.deepEqual(edited.slice(7), ['USR-1', 'DPE-1', 'Clerk One']);
  assert.deepEqual(JSON.parse(passwordEdit[6]), { changes: { password_hash: ['(hidden)', '(changed)'] } });
  assert.ok(!log.flat().some((cell) => /old-hash|new-hash/.test(cell)), 'hashes never reach the log');
  assert.deepEqual([deleted[2], deleted[3], deleted[4]], ['Deleted', 'Members', 'MEM-2']);
  assert.deepEqual(JSON.parse(deleted[6]).row, ['MEM-2', 'PH-2', 'Cruz', '0918', 'Active']);
  assert.deepEqual(book.tables.Members.map((row) => row[0]), ['member_id', 'MEM-1'], 'the row is gone, not blanked');
  // Header rows and the log itself are never audited.
  assert.deepEqual(audit.planValuesUpdate({ range: 'Members!A1:E1', requestBody: { values: [[]] } }).edits, []);
  assert.deepEqual(audit.parseRange("'Payroll Runs'!G5:J5"), { title: 'Payroll Runs', startRow: 5, endRow: 5 });
  assert.equal(audit.parseRange("'Sales'!A:AI"), null);
});

test('deleting rows removes them bottom-up and keeps one row under a frozen header', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  h.rows['User Roles'] = [['user_id', 'role_id'], ['USR-2', 'ROLE-1'], ['USR-3', 'ROLE-1'], ['USR-2', 'ROLE-2']];
  const removed = await h.load('lib/sheet-rows.ts').deleteRowsWhere('User Roles', (row) => row[0] === 'USR-2');
  assert.equal(removed, 2);
  assert.deepEqual(h.writes.at(-1).requestBody.requests.map((request) => request.deleteDimension.range.startIndex), [3, 1], 'bottom-up so indexes stay valid');
});

test('branch names stay unique across territories when creating or renaming', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  h.rows.Branches = [[], ['BR-0022', 'BUTUAN', 'SURIGAO', '', '', '', '', '', '', '', '', '', 'active'], ['BR-0024', 'TORIL', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  const crud = h.load('lib/master-data-crud.ts');
  await h.sync();
  const branch = { name: 'butuan', territory: 'BUTUAN', barangay: '', cityMunicipality: '', province: '', country: '', postalCode: '', contactNumber: '', email: '', dateOpened: '', dateClosed: '', status: 'active' };
  await assert.rejects(() => crud.updateBranchRecord('BR-0024', branch), /already named "butuan"/);
  await crud.updateBranchRecord('BR-0022', { ...branch, name: 'BUTUAN' });
  const route = h.load('app/api/branches/route.ts');
  const response = await route.POST(request({ name: 'Butuan', territory: 'BUTUAN' }));
  assert.equal(response.status, 409, 'same name in another territory is still a duplicate');
});

test('a remittance penalty is noted on the remittance but kept out of the expected amount', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 200; collection[28] = 'Outstanding'; collection[30] = 'DPE-0002'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  collection.length = 37; collection[35] = 50; collection[36] = 'Late turnover: held 5 days';
  deadlineHeaders(h);
  const response = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-1'], actualAmount: 200, remittanceDate: '2026-09-26', remittanceTime: '09:00', receivedByName: 'Cashier' }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.expectedAmount, 200, 'the penalty is independent of the remittance');
  assert.equal(result.remittance.difference, 0);
  const remittance = h.writes[0].requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.match(remittance[22], /Penalty ₱50\.00 \(separate from remittance\): Late turnover: held 5 days/);
  deadlineHeaders(h);
  const dashboard = await h.load('lib/remittance-workflow.ts').getRemittanceDashboard();
  assert.ok(dashboard.remittances.every((item) => item.penaltyAmount === 0 || item.penaltyNotes.length), 'penalties carry their notes');
});

test('profile returns the signed-in person only, with branches and account details but no password hash', async () => {
  const h = harness(null);
  const route = h.load('app/api/profile/route.ts');
  assert.equal((await route.GET()).status, 401);
  h.setUser({ userId: 'USR-2', employeeId: 'MD-2026-0002', name: 'Jo-Ann Bautista', roles: ['ROLE-FIN'], roleNames: ['Finance'], permissions: { manageUsers: false, manageAttendance: true, viewAttendanceReports: false } });
  h.rows.Employees = [[], ['MD-2026-0001', 'Someone Else', 'MATINA', 'MAS', 'active'], ['MD-2026-0002', 'Jo-Ann Bautista', 'TORIL', 'Finance, HR', 'active', '0917 000 0000', 'joann@example.com', '2026-01-15']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-2026-0002', 'BR-0002'], ['EBA-2', 'MD-2026-0001', 'BR-0001']];
  h.rows.Branches = [[], ['BR-0001', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-0002', 'TORIL', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-2', 'MD-2026-0002', 'Jo-Ann Bautista', '$2b$12$secret-hash', 'active', '2026-09-20T01:00:00.000Z', 'ROLE-FIN']];
  const response = await route.GET();
  const text = await response.text();
  assert.equal(response.status, 200, text);
  assert.ok(!text.includes('secret-hash'), 'password hash never leaves the server');
  const { profile } = JSON.parse(text);
  assert.equal(profile.name, 'Jo-Ann Bautista');
  assert.deepEqual(profile.accountRoles, ['Finance']);
  assert.equal(profile.accountCreatedAt, '2026-09-20T01:00:00.000Z');
  assert.deepEqual(profile.employee.branches, [{ id: 'BR-0002', name: 'TORIL', territory: 'METRO DAVAO 1' }]);
  assert.deepEqual(profile.employee.operationalRoles, ['Finance', 'HR Officer']);
  assert.equal(profile.employee.email, 'joann@example.com');
});

test('profile finds the employee through the Users row, flags an ID mismatch, and falls back to the primary branch', async () => {
  const h = harness({ userId: 'USR-2', employeeId: 'MD-2026-0004', name: 'Jo-Ann Bautista', roles: [], roleNames: ['Administrator'], permissions: {} });
  h.rows.Employees = [[], ['MD-2026-0002', 'Jo-Ann Bautista', 'MATINA', 'Administrator', 'active'], ['MD-2026-0082', 'Yman Rey Fernandez', 'BALIOK', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-2026-0002', 'BR-0001']];
  h.rows.Branches = [[], ['BR-0001', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-0004', 'BALIOK', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-2', 'MD-2026-0004', 'Jo-Ann Bautista', 'x', 'active', '', ''], ['USR-5', 'MD-2026-0082', 'Yman Rey Fernandez', 'x', 'active', '', '']];
  const route = h.load('app/api/profile/route.ts');
  let { profile } = await (await route.GET()).json();
  assert.equal(profile.employee.id, 'MD-2026-0002', 'same-name employee is used when the sign-in ID matches nobody');
  assert.deepEqual(profile.employee.branches.map((branch) => branch.name), ['MATINA']);
  assert.match(profile.employeeLinkIssue, /MD-2026-0004 does not match your employee record MD-2026-0002/);
  h.setUser({ userId: 'USR-5', employeeId: 'MD-2026-0082', name: 'Yman Rey Fernandez', roles: [], roleNames: ['MAS'], permissions: {} });
  ({ profile } = await (await route.GET()).json());
  assert.equal(profile.employeeLinkIssue, '');
  assert.deepEqual(profile.employee.branches, [{ id: 'BR-0004', name: 'BALIOK', territory: 'METRO DAVAO 1' }], 'no assignments: the primary branch is shown');
});

test('attendance finds a clock-in even after Google Sheets converted its date and times to numbers', async () => {
  const h = harness();
  const data = h.load('lib/attendance-data.ts');
  assert.equal(data.sheetDateText(46294), '2026-09-29');
  assert.equal(data.sheetDateText('29/09/2026'), '2026-09-29');
  assert.equal(data.sheetDateText('2026-09-29'), '2026-09-29');
  assert.equal(data.sheetTimeText(0.5729166666666666), '13:45');
  assert.equal(data.sheetTimeText('08:00'), '08:00');
  assert.equal(data.sheetTimeText(''), '');
  // The live row as Sheets returns it: date serial and day-fraction times.
  h.rows.Attendance = [[], ['ATT-20260929-MD-2026-0078', 'MD-2026-0078', 46294, 'BUHANGIN', 0.3333333333333333, 0.7083333333333334, 0.5729166666666666]];
  const { record, rowNumber } = await data.getAttendanceForEmployeeDate('MD-2026-0078', '2026-09-29');
  assert.equal(rowNumber, 2);
  assert.deepEqual([record.attendanceDate, record.scheduledTimeIn, record.scheduledTimeOut, record.timeIn, record.timeOut], ['2026-09-29', '08:00', '17:00', '13:45', '']);
  assert.equal((await data.getAttendanceRecordsForRange('2026-09-01', '2026-09-30')).length, 1);
});

test('clock-in uses the branch on the employee record, never one sent by the page', async (t) => {
  const h = harness({ userId: 'USR-5', employeeId: 'MD-2026-0082', name: 'Yman Rey Fernandez', roleNames: ['MAS'], permissions: {} });
  const attendance = h.load('lib/attendance.ts');
  if (new Date(`${attendance.getPhilippineDate()}T00:00:00Z`).getUTCDay() === 0) return t.skip('clocking is closed on Sundays');
  h.rows.Employees = [[], ['MD-2026-0082', 'Yman Rey Fernandez', 'BALIOK', 'MAS', 'active'], ['MD-2026-0099', 'No Branch', '', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-2026-0082', 'BR-0001'], ['EBA-2', 'MD-2026-0082', 'BR-0004'], ['EBA-3', 'MD-2026-0082', 'BR-0002']];
  h.rows.Branches = [[], ['BR-0001', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-0002', 'TORIL', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-0004', 'BALIOK', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Attendance = [[]];
  const route = h.load('app/api/attendance/route.ts');
  const status = await (await route.GET()).json();
  assert.equal(status.assignedBranch, 'BALIOK');
  assert.deepEqual(status.assignedBranches, ['BALIOK', 'MATINA', 'TORIL'], 'primary first, then the other assignments');
  const response = await route.POST(request({ action: 'time-in', branch: 'SOMEWHERE ELSE' }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const row = h.writes.find((write) => write.range?.startsWith("'Attendance'!")).requestBody.values[0];
  assert.equal(row[3], 'BALIOK', 'the submitted branch is ignored');
  assert.match(row[2], /^'\d{4}-\d{2}-\d{2}$/, 'the date is saved as text so Sheets cannot turn it into a number');
  h.setUser({ userId: 'USR-9', employeeId: 'MD-2026-0099', name: 'No Branch', roleNames: ['MAS'], permissions: {} });
  const refused = await route.POST(request({ action: 'time-in', branch: 'BALIOK' }));
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).message, /No branch is assigned/);
});

test('new sales are remitted on their own slip, separate from collections', async () => {
  // An approver sees every entry (an Entry Clerk sees only what they encoded).
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Approver', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const collectionsHeader = Array(37).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(37).fill(''); collection[0] = 'COL-1'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 270; collection[28] = 'Outstanding'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const sale = Array(38).fill(''); sale[0] = 'SAL-1'; sale[1] = '2026-09-25T02:00:00.000Z'; sale[2] = 'BR-1'; sale[3] = 'Maria'; sale[5] = 'PH-2'; sale[21] = 'DP-1'; sale[23] = 'Cash'; sale[26] = 500; sale[28] = 'APP-7'; sale[35] = 'Outstanding'; sale[37] = 'DPE-2'; sale.push(25, 'Late turnover of new sales');
  const remittancesHeader = Array(26).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Sales = [Array(38).fill(''), sale];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const route = h.load('app/api/remittances/route.ts');
  const dashboard = await (await route.GET()).json();
  assert.deepEqual(dashboard.outstanding.map((item) => [item.kind, item.id, item.remittanceAmount, item.penalty]), [['Collections', 'COL-1', 270, 0], ['New Sales', 'SAL-1', 500, 25]]);
  const post = async (body) => { const response = await route.POST(request({ actualAmount: 500, remittanceDate: '2026-09-26', remittanceTime: '09:00', ...body })); return { status: response.status, body: await response.json() }; };
  assert.match((await post({ collectionIds: ['COL-1', 'SAL-1'] })).body.error, /separate slips/);
  const created = await post({ collectionIds: ['SAL-1'], actualAmount: 500 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.remittance.type, 'New Sales');
  assert.equal(created.body.remittance.expectedAmount, 500, 'the full amount paid on the sale; the batch penalty is separate');
  const requests = h.writes.at(-1).requestBody.requests;
  const remittance = requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(remittance[25], 'New Sales');
  const saleStatus = requests.at(-1).updateCells;
  assert.equal(saleStatus.range.startColumnIndex, 35, 'the sale is marked in Sales AJ:AK, not in Collections');
  assert.deepEqual(saleStatus.rows[0].values.map((value) => value.userEnteredValue.stringValue), ['Pending Remittance Approval', created.body.remittance.id]);
});

test('New Sales Fidelity is the MAS own money: incentives stay whole and the remittance expects it', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'Maria', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'Maria']);
  const sales = h.load('app/api/sales/route.ts');
  const body = (fidelityAmount) => ({ branch: 'BR-1', mas: 'Maria', dateRemitted: '2026-09-25', fidelityAmount, controlTotal: 350, sales: [{ existingMember: false, memberNumber: '', programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-9', addressHouse: 'Address', beneficiaries: [] }] });
  // No limit: more than the batch's ₱150 incentive is accepted.
  const saved = await sales.POST(request(body(500)));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const [saved1] = await query('select mas_incentive, remittance_amount, fidelity_amount from sales');
  assert.deepEqual(Object.values(saved1).map(Number), [150, 200, 500], 'the incentive is untouched; company share and the batch Fidelity');

  // Its remittance expects the company share plus the Fidelity.
  const h2 = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Approver', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const sale = Array(43).fill(''); sale[0] = 'SAL-9'; sale[1] = '2026-09-25T02:00:00.000Z'; sale[2] = 'BR-1'; sale[3] = 'Maria'; sale[21] = 'DP-1'; sale[26] = 350; sale[35] = 'Outstanding'; sale[37] = 'DPE-0002'; sale[40] = 150; sale[41] = 200; sale[42] = 50;
  const collectionsHeader = Array(37).fill(''); collectionsHeader[28] = 'Remittance Status';
  const remittancesHeader = Array(26).fill(''); remittancesHeader[12] = 'Difference';
  h2.rows.Collections = [collectionsHeader]; h2.rows.Sales = [Array(43).fill(''), sale]; h2.rows.Remittances = [remittancesHeader];
  h2.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h2);
  const remittances = h2.load('app/api/remittances/route.ts');
  const outstanding = (await (await remittances.GET()).json()).outstanding;
  assert.deepEqual(outstanding.map((item) => [item.id, item.remittanceAmount, item.fidelity]), [['SAL-9', 200, 50]]);
  const created = await remittances.POST(request({ collectionIds: ['SAL-9'], actualAmount: 250, remittanceDate: '2026-09-26', remittanceTime: '09:00' }));
  const result = await created.json();
  assert.equal(created.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.expectedAmount, 250, 'company share 200 + Fidelity 50');
  assert.equal(result.remittance.difference, 0);
  assert.equal(result.remittance.fidelityAmount, 50);
  const row = h2.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.match(row[22], /Fidelity ₱50\.00 \(employee's own money\), included in the expected amount/);
});

test('fidelity entered with a Collections batch is added to its remittance, not taken from incentives', async () => {
  const h = harness();
  const collectionsHeader = Array(38).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(38).fill(''); collection[0] = 'COL-9'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-9'; collection[9] = '2026-09-25'; collection[10] = 320; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 270; collection[28] = 'Outstanding'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS'; collection[37] = 20;
  const remittancesHeader = Array(26).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Sales = [Array(40).fill('')];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const route = h.load('app/api/remittances/route.ts');
  const post = async (body) => { const response = await route.POST(request({ collectionIds: ['COL-9'], actualAmount: 290, remittanceDate: '2026-09-26', remittanceTime: '09:00', ...body })); return { status: response.status, body: await response.json() }; };
  assert.match((await post({ fidelityAmount: 5 })).body.error, /already recorded/);
  const created = await post({});
  assert.equal(created.status, 201, JSON.stringify(created.body));
  // Collected 320: company share 270 + the MAS's own Fidelity 20 = 290 expected; the MAS keeps the full 50 incentive.
  assert.equal(created.body.remittance.expectedAmount, 290);
  assert.equal(created.body.remittance.difference, 0);
  assert.equal(created.body.remittance.fidelityAmount, 20);
  const remittance = h.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(remittance[24], 20, 'the Fidelity is recorded on the remittance, where the Fidelity page reads it');
});

test('daily audit: HR, Finance, and Admin can open it; only Admin approves and approval locks the audit', async () => {
  const access = harness().load('lib/access-control.ts');
  const can = (role) => access.canAccessPath({ roleNames: [role], permissions: { manageUsers: false, manageAttendance: false, viewAttendanceReports: false } }, '/audit');
  assert.deepEqual(['HR Officer', 'Finance', 'Administrator', 'Entry Clerk', 'MAS'].map(can), [true, true, true, false, false]);

  const h = harness({ userId: 'USR-2', employeeId: 'MD-1', name: 'HR Person', roleNames: ['HR Officer'], permissions: {} });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-3', 'MD-3', 'Clerk One', 'x', 'active', '', 'R-EC'], ['USR-4', 'MD-4', 'Only MAS', 'x', 'active', '', 'R-MAS']];
  h.rows.Roles = [[], ['R-EC', 'Entry Clerk', '', false, false, false, 'active'], ['R-MAS', 'MAS', '', false, false, false, 'active']];
  h.rows['User Roles'] = [[], ['USR-3', 'R-EC'], ['USR-4', 'R-MAS']];
  h.rows.Employees = [[], ['MD-3', 'Clerk One', 'MATINA', 'Entry Clerk', 'active'], ['MD-4', 'Only MAS', 'MATINA', 'MAS', 'active'], ['MD-8', 'Finance Person', 'TORIL', 'Finance', 'active'], ['MD-9', 'Old Clerk', 'TORIL', 'Entry Clerk', 'resigned']];
  h.rows['Employee Branches'] = [[]];
  h.rows['Daily Audits'] = [[]];
  await h.sync();
  const audit = h.load('lib/daily-audit.ts');
  assert.deepEqual((await audit.auditedEmployees()).map((item) => item.name), ['Clerk One'], 'only active Entry Clerks are audited');
  await assert.rejects(audit.saveDailyAudit({ date: '2026-09-28', employeeId: 'MD-3', findings: '', result: 'With findings' }), /Describe the findings/);
  await assert.rejects(audit.saveDailyAudit({ date: '2026-09-28', employeeId: 'MD-4', findings: '', result: 'Balanced' }), /Only active Entry Clerks/);

  const route = h.load('app/api/audit/route.ts');
  const post = await route.POST(request({ date: '2026-09-28', employeeId: 'MD-3', findings: 'Receipts match', result: 'Balanced' }));
  assert.equal(post.status, 200, JSON.stringify(await post.clone().json()));
  const saved = h.writes.find((write) => write.range.startsWith("'Daily Audits'!")).requestBody.values[0];
  assert.deepEqual([saved[1], saved[2], saved[4], saved[6], saved[7]], ['2026-09-28', 'MD-3', 'Draft', 'Receipts match', 'Balanced']);
  assert.equal((await route.PATCH(request({ date: '2026-09-28', employeeId: 'MD-3', decision: 'approve' }))).status, 403, 'HR prepares; only Admin approves');

  h.rows['Daily Audits'] = [[], [...saved.slice(0, 13)]];
  h.setUser({ userId: 'USR-1', employeeId: 'MD-0', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const approved = await route.PATCH(request({ date: '2026-09-28', employeeId: 'MD-3', decision: 'approve' }));
  assert.equal(approved.status, 200, JSON.stringify(await approved.clone().json()));
  assert.equal(h.writes.at(-1).requestBody.values[0][0], 'Approved');
  h.rows['Daily Audits'][1][4] = 'Approved';
  assert.match((await (await route.POST(request({ date: '2026-09-28', employeeId: 'MD-3', findings: 'x', result: 'Balanced' }))).json()).message, /approved and locked/);
  assert.match((await (await route.PATCH(request({ date: '2026-09-28', employeeId: 'MD-3', decision: 'reopen', reason: '' }))).json()).message, /reason/);
});

test('a program enrollment transfers only to an active employee in the same branch, with a reason and history', async () => {
  const h = harness({ userId: 'USR-2', employeeId: 'MD-1', name: 'HR Person', roleNames: ['HR Officer'], permissions: {} });
  await seedAccount({ doi: '2026-01-15', branch: 'MATINA', mas: 'Old MAS' });
  await seed('employees', [{ employee_id: 'MD-6', full_name: 'New MAS' }]);
  h.rows.Employees = [[], ['MD-5', 'Old MAS', 'MATINA', 'MAS', 'active'], ['MD-6', 'New MAS', 'MATINA', 'MAS', 'active'], ['MD-7', 'Toril MAS', 'TORIL', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-5', 'BR-1'], ['EBA-2', 'MD-6', 'BR-1'], ['EBA-3', 'MD-7', 'BR-2']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO', '', '', '', '', '', '', '', '', '', 'active'], ['BR-2', 'TORIL', 'METRO', '', '', '', '', '', '', '', '', '', 'active']];
  const route = h.load('app/api/members/transfer/route.ts');
  const listed = await (await route.GET(new Request('http://localhost/api/members/transfer?enrollmentId=ENR-1'))).json();
  assert.deepEqual(listed.candidates.map((item) => item.name), ['New MAS'], 'same branch, not the current MAS');
  assert.match((await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-7', reason: 'Moved' }))).json()).message, /assigned to MATINA/);
  assert.match((await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: '' }))).json()).message, /reason/);
  const done = await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: 'Old MAS resigned' }))).json();
  assert.deepEqual([done.transfer.fromMas, done.transfer.toMas], ['Old MAS', 'New MAS']);
  assert.equal((await query("select mas from member_programs where enrollment_id = 'ENR-1'"))[0].mas, 'New MAS', 'the enrollment MAS changes');
  const [history] = await query('select enrollment_id, member_id, member_number, program_id, branch, from_mas, to_mas, to_employee_id, reason, encoded_by_name from member_transfers');
  assert.deepEqual(Object.values(history), ['ENR-1', 'MEM-1', 'PH-1', 'DP-1', 'MATINA', 'Old MAS', 'New MAS', 'MD-6', 'Old MAS resigned', 'HR Person']);
  assert.deepEqual(await query('select table_name, record_id, employee_id from audit_log'), [{ table_name: 'member_programs', record_id: 'ENR-1', employee_id: 'MD-1' }], 'the MAS change is audited');
  h.setUser({ userId: 'USR-3', employeeId: 'MD-3', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: 'x y z' }))).status, 403, 'only Administrators and HR Officers');
});

test('audit summary counts only approved Entry Clerk audits in the period, by branch and clerk', async () => {
  const h = harness({ userId: 'USR-1', employeeId: 'MD-0', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  h.rows.Employees = [[], ['MD-3', 'Clerk One', 'MATINA', 'Entry Clerk', 'active'], ['MD-5', 'Clerk Two', 'TORIL', 'Entry Clerk', 'active'], ['MD-8', 'Finance Person', 'TORIL', 'Finance', 'active']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-2', 'TORIL', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active'], ['BR-3', 'CALINAN', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[]];
  const figures = (gross, remit) => JSON.stringify({ accounts: 1, gross, incentives: gross - remit, fidelity: 0, penalty: 0, expectedRemittance: remit, sales: [], collections: [] });
  const audit = (id, date, employeeId, name, status, result, gross, remit) => [id, date, employeeId, name, status, figures(gross, remit), result === 'With findings' ? 'Short by 50' : '', result, '', status === 'Approved' ? 'Admin' : '', status === 'Approved' ? '2026-09-10T09:00:00Z' : '', '', ''];
  h.rows['Daily Audits'] = [[],
    audit('A1', '2026-09-01', 'MD-3', 'Clerk One', 'Approved', 'Balanced', 320, 270),
    audit('A2', '2026-09-02', 'MD-3', 'Clerk One', 'Approved', 'With findings', 640, 540),
    audit('A3', '2026-09-03', 'MD-3', 'Clerk One', 'Draft', 'Balanced', 100, 100),
    audit('A4', '2026-09-02', 'MD-5', 'Clerk Two', 'Approved', 'Balanced', 500, 500),
    audit('A5', '2026-08-31', 'MD-3', 'Clerk One', 'Approved', 'Balanced', 999, 999),
    audit('A6', '2026-09-02', 'MD-8', 'Finance Person', 'Approved', 'Balanced', 777, 777)];
  const route = h.load('app/api/audit/summary/route.ts');
  const get = async (query) => (await (await route.GET(new Request(`http://localhost/api/audit/summary?${query}`))).json()).summary;
  const all = await get('from=2026-09-01&to=2026-09-30');
  assert.deepEqual(all.counts, { approved: 3, balanced: 2, withFindings: 1, drafts: 1 }, 'August, drafts, and non-clerks are excluded');
  assert.equal(all.totals.gross, 1460);
  assert.equal(all.totals.expectedRemittance, 1310);
  assert.deepEqual(all.byClerk.map((clerk) => [clerk.name, clerk.approvedDays, clerk.withFindings, clerk.drafts]), [['Clerk One', 2, 1, 1], ['Clerk Two', 1, 0, 0]]);
  const toril = await get('from=2026-09-01&to=2026-09-30&branch=TORIL');
  assert.deepEqual(toril.audits.map((item) => item.employeeName), ['Clerk Two']);
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-3', 'BR-1'], ['EBA-2', 'MD-3', 'BR-3']];
  h.clearCache?.();
  const calinan = await get('from=2026-09-01&to=2026-09-30&branch=CALINAN');
  assert.deepEqual(calinan.byClerk.map((clerk) => clerk.name), ['Clerk One'], 'a clerk counts for every assigned branch, not only the primary one');
  assert.equal(calinan.counts.approved, 2);
  assert.deepEqual(calinan.branches, ['CALINAN', 'MATINA', 'TORIL']);
  const one = await get('from=2026-09-01&to=2026-09-30&employeeId=MD-3');
  assert.deepEqual(one.audits.map((item) => item.date), ['2026-09-02', '2026-09-01'], 'newest first');
  h.setUser({ userId: 'USR-3', employeeId: 'MD-3', name: 'Clerk One', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.GET(new Request('http://localhost/api/audit/summary?from=2026-09-01&to=2026-09-30'))).status, 403);
});

test('New Sales refuses a member or claimant contact number that belongs to an employee', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active', '0917 123 4567']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
  const sale = { existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', addressHouse: 'Complete Address', contactNumber: '0918 000 0000', claimantContact: '0918 000 0001', beneficiaries: [] };
  const post = async (overrides) => { const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', sales: [{ ...sale, ...overrides }] })); return { status: response.status, body: await response.json() }; };
  const member = await post({ contactNumber: '+63 917 123 4567' });
  assert.equal(member.status, 400);
  assert.match(member.body.message, /Member contact number .* belongs to employee different-mas \(DPE-0002\)/);
  const claimant = await post({ claimantContact: '09171234567' });
  assert.match(claimant.body.message, /Claimant contact number .* belongs to employee different-mas/);
  assert.equal(h.writes.length, 0, 'nothing is saved');
});

test('member directory: Collector per program, deceased members, and the standing filters', () => {
  const { buildMemberDirectory, filterMemberDirectory, emptyDirectoryFilters } = harness().load('lib/member-directory.ts');
  const member = (id, number, status) => ({ id, number, surname: id, firstName: '', middleName: '', nameExtension: '', birthdate: '', birthplace: '', gender: '', civilStatus: '', contact: '', address: 'Purok 1, Matina', status, claimant: '', claimantContact: '', claimantSameAddress: false, claimantAddress: '' });
  const enrollment = (id, memberId, memberNumber) => ({ id, memberId, memberNumber, programId: 'DP-1', doi: '2026-01-10', branch: 'BR-1', mas: 'Maria', paymentMethod: 'Cash', status: 'Active' });
  // Only Collector collections are passed (the database query selects them); the latest one wins.
  const collector = (memberNumber, date, person) => ({ memberNumber, programId: 'DP-1', date, person });
  const members = buildMemberDirectory(
    [member('M1', 'PH-1', 'Active'), member('M2', 'PH-2', 'Deceased'), member('M3', 'PH-3', 'Inactive')],
    [enrollment('E1', 'M1', 'PH-1'), enrollment('E2', 'M2', 'PH-2'), enrollment('E3', 'M3', 'PH-3')],
    { 'DP-1': 'Program' },
    [collector('PH-1', '2026-05-01', 'Jun Collector'), collector('PH-1', '2026-03-01', 'Old Collector')],
  );
  const one = (id) => members.find((item) => item.id === id);
  assert.equal(one('M1').enrollments[0].collector, 'Jun Collector', 'the latest Collector collection');
  assert.equal(one('M3').enrollments[0].collector, '');
  assert.equal(one('M2').deceased, true);
  one('M3').enrollments[0].accountStatus = 'Forfeited';
  const ids = (standing) => filterMemberDirectory(members, { ...emptyDirectoryFilters, standing }).map((item) => item.id).sort().join(',');
  assert.equal(ids('active'), 'M1');
  assert.equal(ids('inactive'), 'M3');
  assert.equal(ids('dead'), 'M2');
  assert.equal(ids('alive'), 'M1,M3');
  assert.equal(ids('forfeited'), 'M3');
  assert.equal(filterMemberDirectory(members, { ...emptyDirectoryFilters, mas: 'Jun Collector' }).map((item) => item.id).join(','), 'M1', 'the MAS / Collector filter finds Collectors');
  assert.equal(filterMemberDirectory(members, { ...emptyDirectoryFilters, search: 'matina' }).length, 3, 'search covers the address');
});

test('incentives are kept until 10:00 AM the day after the OR date, then the full amount is remitted', async () => {
  const setup = () => {
    const h = harness();
    const collection = Array(39).fill(''); collection[0] = 'COL-5'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-5'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[26] = 270; collection[28] = 'Outstanding'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS';
    const collectionsHeader = Array(39).fill(''); collectionsHeader[28] = 'Remittance Status';
    const remittancesHeader = Array(27).fill(''); remittancesHeader[12] = 'Difference';
    h.rows.Collections = [collectionsHeader, collection]; h.rows.Remittances = [remittancesHeader];
    h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
    deadlineHeaders(h);
    return h;
  };
  const post = async (h, remittanceTime, actualAmount) => { const response = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-5'], actualAmount, remittanceDate: '2026-09-26', remittanceTime })); return { status: response.status, body: await response.json() }; };

  const onTime = setup();
  const kept = await post(onTime, '10:00', 270);
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.equal(kept.body.remittance.expectedAmount, 270, '10:00 exactly is within 24 hours of the cutoff');
  assert.equal(kept.body.remittance.forfeitedCount, 0);
  const keptRow = onTime.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(keptRow[26], '10:00', 'the time received is stored on the slip');

  const late = setup();
  const forfeited = await post(late, '10:01', 350);
  assert.equal(forfeited.status, 201, JSON.stringify(forfeited.body));
  assert.equal(forfeited.body.remittance.expectedAmount, 350, 'the whole collection goes to the remittance');
  assert.equal(forfeited.body.remittance.forfeitedAmount, 80);
  const requests = late.writes.at(-1).requestBody.requests;
  const remarks = requests[0].appendCells.rows[0].values[22].userEnteredValue.stringValue;
  assert.match(remarks, /Incentive forfeited on 1 item \(₱80\.00\)/);
  assert.equal(requests[1].appendCells.rows[0].values[3].userEnteredValue.numberValue, 350, 'the link records the amount actually due');
  const cells = requests.filter((item) => item.updateCells).map((item) => [item.updateCells.range.startColumnIndex, item.updateCells.rows[0].values[0].userEnteredValue.numberValue]);
  assert.deepEqual(cells.filter(([column]) => column === 26 || column === 38), [[26, 350], [38, 80]], 'remittance_amount becomes the full amount and the forfeit is recorded');

  const future = await post(setup(), '23:59', 350);
  assert.equal(future.status, 201, 'a past date with a late time is fine');
  const tomorrow = setup();
  const ahead = await tomorrow.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-5'], actualAmount: 350, remittanceDate: '2099-01-01', remittanceTime: '09:00' }));
  assert.match((await ahead.json()).error, /cannot be in the future/);
});

test('a late New Sale moves its MAS incentive into the remittance, and a rejected slip gives it back', async () => {
  const h = harness();
  const sale = Array(44).fill(''); sale[0] = 'SAL-5'; sale[1] = '2026-09-25T02:00:00.000Z'; sale[2] = 'BR-1'; sale[3] = 'Maria'; sale[26] = 350; sale[30] = '2026-09-25'; sale[35] = 'Outstanding'; sale[37] = 'DPE-2'; sale[40] = 150; sale[41] = 200;
  const remittancesHeader = Array(27).fill(''); remittancesHeader[12] = 'Difference';
  const collectionsHeader = Array(39).fill(''); collectionsHeader[28] = 'Remittance Status';
  h.rows.Collections = [collectionsHeader]; h.rows.Sales = [Array(44).fill(''), sale]; h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const created = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['SAL-5'], actualAmount: 350, remittanceDate: '2026-09-27', remittanceTime: '08:00' }));
  const result = await created.json();
  assert.equal(created.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.expectedAmount, 350);
  const updates = h.writes.at(-1).requestBody.requests.filter((item) => item.updateCells && item.updateCells.range.startColumnIndex >= 40)
    .map((item) => [item.updateCells.range.startColumnIndex, ...item.updateCells.rows[0].values.map((value) => value.userEnteredValue.numberValue)]);
  assert.deepEqual(updates, [[40, 0, 350], [43, 150]], 'mas_incentive 0, remittance_amount 350, forfeited 150');

  // The slip is rejected: the sale is outstanding again with its incentive restored.
  const admin = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const pendingSale = [...sale]; pendingSale[35] = 'Pending Remittance Approval'; pendingSale[36] = 'REM-5'; pendingSale[40] = 0; pendingSale[41] = 350; pendingSale[43] = 150;
  const slip = Array(27).fill(''); slip[0] = 'REM-5'; slip[4] = 'Pending Approval'; slip[6] = 'USR-1'; slip[10] = 350; slip[11] = 350; slip[25] = 'New Sales'; slip[26] = '08:00';
  admin.rows.Collections = [collectionsHeader]; admin.rows.Sales = [Array(44).fill(''), pendingSale]; admin.rows.Remittances = [remittancesHeader, slip];
  admin.rows['Remittance Collections'] = [['Remittance Collection ID'], ['RCL-5', 'REM-5', 'SAL-5', 350]];
  deadlineHeaders(admin);
  const rejected = await admin.load('app/api/remittances/route.ts').PATCH(request({ remittanceId: 'REM-5', decision: 'reject', reason: 'Recount needed' }));
  assert.equal(rejected.status, 200, JSON.stringify(await rejected.clone().json()));
  const restored = admin.writes.at(-1).requestBody.requests.filter((item) => item.updateCells && item.updateCells.range.startColumnIndex >= 40)
    .map((item) => [item.updateCells.range.startColumnIndex, ...item.updateCells.rows[0].values.map((value) => value.userEnteredValue.numberValue ?? value.userEnteredValue.stringValue)]);
  assert.deepEqual(restored, [[40, 150, 200], [43, '']]);
});

test('a program locks the New Sale amount unless it allows editing', async () => {
  const setup = (editable) => {
    const h = harness();
    h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
    h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
    h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
    const program = ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', editable, 'FALSE'];
    h.rows.Programs = [[], program];
    h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
    return h;
  };
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const post = async (h, amountPaid) => {
    const sale = { existingMember: false, programId: 'DP-1', amountPaid, applicationNo: 'APP-1', addressHouse: 'Complete Address', beneficiaries: [] };
    const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: Number(amountPaid), sales: [sale] }));
    return { status: response.status, body: await response.json() };
  };
  const locked = setup('FALSE');
  const typo = await post(locked, '3500');
  assert.equal(typo.status, 400);
  assert.match(typo.body.message, /fixed amount of ₱350\.00/, 'no registration fee: the first month\'s base pay');
  assert.equal(await count('sales'), 0, 'nothing is saved');
  const blank = setup('');
  assert.equal((await post(blank, '300')).status, 400, 'a blank cell is FALSE, the default');
  const editable = setup('TRUE');
  const different = await post(editable, '700');
  assert.equal(different.status, 200, JSON.stringify(different.body));
});

test('a New Sales batch must match the turnover sheet total, and a late application date needs a reason', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const post = async (body) => {
    const sale = { existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', addressHouse: 'Complete Address', beneficiaries: [], ...body.sale };
    const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: body.controlTotal, sales: [sale] }));
    return { status: response.status, body: await response.json() };
  };
  assert.match((await post({ controlTotal: 3500 })).body.message, /add up to ₱350\.00 but the turnover sheet says ₱3,500\.00 \(short by ₱3,150\.00\)/);
  assert.match((await post({})).body.message, /Enter the control total/);
  const late = await post({ controlTotal: 350, sale: { orDate: '2026-01-05' } });
  assert.match(late.body.message, /more than a day old/);
  assert.equal(await count('sales'), 0, 'nothing is saved');
  const explained = await post({ controlTotal: 350, sale: { orDate: '2026-01-05', backdateReason: 'MAS turned in the form late' } });
  assert.equal(explained.status, 200, JSON.stringify(explained.body));
  assert.equal((await query('select backdate_reason from sales'))[0].backdate_reason, 'MAS turned in the form late', 'the reason is kept with the sale');
});

test('a counted cash remittance must add up to the amount received, and the count is kept on the slip', async () => {
  const h = harness();
  const collection = Array(39).fill(''); collection[0] = 'COL-7'; collection[6] = 'BR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[26] = 270; collection[28] = 'Outstanding'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const collectionsHeader = Array(39).fill(''); collectionsHeader[28] = 'Remittance Status';
  const remittancesHeader = Array(28).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection]; h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const route = h.load('app/api/remittances/route.ts');
  const post = async (cashCount) => { const response = await route.POST(request({ collectionIds: ['COL-7'], actualAmount: 270, remittanceDate: '2026-09-26', remittanceTime: '09:00', cashCount })); return { status: response.status, body: await response.json() }; };
  assert.match((await post('200x1, 50x1')).body.error, /counted cash adds up to ₱250/);
  assert.match((await post('300x1')).body.error, /could not be read/);
  const counted = await post('200x1, 50x1, 20x1');
  assert.equal(counted.status, 201, JSON.stringify(counted.body));
  const row = h.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(row[27], '200x1, 50x1, 20x1');
});

test('exceptions find bad dates, wrong amounts, duplicates, incomplete members, overdue cash and late entries', async () => {
  const h = harness();
  const collection = (id, values) => { const row = Array(40).fill(''); Object.assign(row, { 0: id, 2: 'ENR-1', 4: 'PH-1', 5: 'DP-1', 7: 'Maria', 8: `OR-${id}`, 9: '2026-09-01', 10: 350, 11: '2026-09', 12: '2026-09', 13: 2, 19: 'Posted', 24: '2026-09-01T02:00:00.000Z', 28: 'Remitted' }, values); return row; };
  h.rows.Collections = [[],
    collection('COL-A', { 9: '206-07-21' }),
    collection('COL-B', { 10: 300, 13: 3 }),
    collection('COL-C', { 8: 'OR-COL-A', 13: 4 }),
    collection('COL-D', { 9: '2026-09-02', 13: 5, 28: 'Outstanding' }),
    collection('COL-E', { 13: 6, 39: 'Receipt turned in late', 24: new Date().toISOString() }),
    collection('COL-LEG-1', { 9: '2099-01-01', 13: 7 }),
  ];
  const sale = Array(45).fill(''); Object.assign(sale, { 0: 'SAL-1', 1: '2026-09-01T02:00:00.000Z', 21: 'DP-1', 26: 400, 28: 'APP-1', 30: '2026-09-01', 35: 'Remitted' });
  h.rows.Sales = [[], sale];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', 'FALSE', 'FALSE']];
  const member = (id, birthdate, contact, address) => { const row = Array(18).fill(''); Object.assign(row, { 0: id, 1: id, 2: 'Cruz', 3: 'Ana', 6: birthdate, 11: contact, 12: address, 17: 'Active' }); return row; };
  h.rows.Members = [[], member('M-1', '1990-01-01', '0917', 'Matina'), member('M-2', '1990-01-01', '0918', 'Toril'), member('M-3', '', '', 'Calinan')];
  const { findExceptions } = h.load('lib/exceptions.ts');
  const result = await findExceptions();
  const ids = (category) => result.categories.find((item) => item.category === category).items.map((item) => item.recordId);
  assert.deepEqual(ids('dates'), ['COL-A'], 'year 206; the legacy row is hidden by default');
  assert.deepEqual(ids('amounts').sort(), ['COL-B', 'SAL-1'], '₱300 for one month, and ₱400 on a program fixed at ₱350');
  assert.deepEqual(ids('duplicates').sort(), ['COL-C', 'M-2'], 'a reused OR number and a member registered twice');
  assert.deepEqual(ids('members'), ['M-3']);
  assert.match(result.categories.find((item) => item.category === 'members').items[0].problem, /birthdate, contact number/);
  assert.deepEqual(ids('overdue'), ['COL-D']);
  assert.deepEqual(ids('backdated'), ['COL-E']);
  const fix = result.categories.find((item) => item.category === 'dates').items[0].entry;
  assert.deepEqual([fix.kind, fix.orNumber, fix.onRemittance], ['Collection', 'OR-COL-A', true], 'the correction form gets what it needs');
  assert.deepEqual((await findExceptions({ includeLegacy: true })).categories.find((item) => item.category === 'dates').items.map((item) => item.recordId).sort(), ['COL-A', 'COL-LEG-1']);
});

test('date checks flag dates that are out of order or far apart, and block the impossible ones', () => {
  const { dateWarnings, blockingDateProblem } = harness().load('lib/date-checks.ts');
  // The imported collection: OR dated 2026-10-03 but recorded on 2026-09-18.
  const legacy = dateWarnings({ receiptDate: '2026-10-03', recordedOn: '2026-09-18', today: '2026-10-03' });
  assert.equal(legacy.length, 1);
  assert.match(legacy[0], /15 days after the entry was recorded \(2026-09-18\)/);
  assert.deepEqual(dateWarnings({ receiptDate: '2026-10-01', dateRemitted: '2026-10-02', recordedOn: '2026-10-02', today: '2026-10-03' }), [], 'a normal entry has no warnings');
  assert.match(dateWarnings({ receiptDate: '2026-10-03', dateRemitted: '2026-09-18', today: '2026-10-03' })[0], /Remitted on 2026-09-18, 15 days before the OR date/);
  assert.match(dateWarnings({ receiptDate: '2026-09-01', dateRemitted: '2026-09-20', today: '2026-10-03' })[0], /Remitted 19 days after the OR date/);
  assert.match(dateWarnings({ receiptDate: '2026-08-01', recordedOn: '2026-10-03', today: '2026-10-03' })[0], /Encoded 63 days after/);
  assert.match(dateWarnings({ receiptDate: '2026-09-01', dateRemitted: '2026-09-02', slipDate: '2026-09-10', today: '2026-10-03' })[0], /slip is dated 2026-09-10/);
  assert.match(blockingDateProblem({ receiptDate: '2026-10-03', dateRemitted: '2026-09-18', today: '2026-10-03' }), /cannot be before the OR date/);
  assert.match(blockingDateProblem({ receiptDate: '2026-10-03', dateRemitted: '2026-10-09', today: '2026-10-03' }), /cannot be in the future/);
  assert.equal(blockingDateProblem({ receiptDate: '2026-10-01', dateRemitted: '2026-10-02', today: '2026-10-03' }), '');
});

test('after the day ends, unmarked employees are recorded absent by the system, except on closed days', () => {
  const { systemAbsences, isSystemAbsence, SYSTEM_ABSENCE_NOTE } = harness().load('lib/auto-absence.ts');
  const employees = [{ employeeId: 'E1' }, { employeeId: 'E2' }, { employeeId: 'E3' }];
  const branches = new Map([['E1', 'MATINA'], ['E2', 'TORIL'], ['E3', 'MATINA']]);
  // Sat 2026-10-03 to Mon 2026-10-05: E1 clocked in Saturday, E2 was marked AWOL Monday, TORIL closed Saturday.
  const records = [{ employeeId: 'E1', attendanceDate: '2026-10-03' }, { employeeId: 'E2', attendanceDate: '2026-10-05' }];
  const closures = [{ date: '2026-10-03', reason: 'Fiesta', allBranches: false, branchIds: ['BR-2'], branchNames: ['TORIL'], updatedAt: '' }];
  const absences = systemAbsences({ from: '2026-10-03', to: '2026-10-05', employees, branches, records, closures, timestamp: 'now' });
  assert.deepEqual(absences.map((item) => `${item.employeeId} ${item.attendanceDate}`), ['E3 2026-10-03', 'E1 2026-10-05', 'E3 2026-10-05'], 'Sunday skipped; recorded and closed days left alone');
  assert.equal(absences[0].status, 'Absent');
  assert.equal(absences[0].notes, SYSTEM_ABSENCE_NOTE);
  assert.equal(isSystemAbsence(absences[0]), true);
  assert.equal(isSystemAbsence({ status: 'Absent', notes: 'Marked by HR' }), false, 'an absence marked by management is not the system');
});

test('a MAS sees only their own members; oversight roles see everyone', async () => {
  const h = harness();
  h.rows.Employees = [[], ['DPE-0002', 'Maria Santos', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  await h.sync();
  const { ownMembersScope, isOwnAccount } = h.load('lib/member-scope.ts');
  assert.equal(await ownMembersScope({ roleNames: ['MAS'], employeeId: 'DPE-0002', name: 'maria' }), 'Maria Santos', 'the name on the employee record, as on enrollments');
  assert.equal(await ownMembersScope({ roleNames: ['MAS', 'Administrator'], employeeId: 'DPE-0002', name: 'Maria Santos' }), null);
  assert.equal(await ownMembersScope({ roleNames: ['Finance'], employeeId: 'DPE-9', name: 'Fin' }), null);
  assert.equal(isOwnAccount(' maria santos ', 'Maria Santos'), true);
  assert.equal(isOwnAccount('Jose Cruz', 'Maria Santos'), false);
  assert.equal(isOwnAccount('', await ownMembersScope({ roleNames: ['MAS'], employeeId: 'NOBODY', name: '' })), false, 'no name matches nothing');
});

test('an Entry Clerk report counts only what that clerk encoded, grouped like the paper report', async () => {
  const h = harness();
  const collection = (id, encoder, encodedAt, amount, share, fidelity = '') => { const row = Array(41).fill(''); Object.assign(row, { 0: id, 5: 'DP-1', 6: 'AGDAO', 7: 'Maria', 8: `OR-${id}`, 9: encodedAt.slice(0, 10), 10: amount, 19: 'Posted', 20: encodedAt, 22: encoder, 23: 'Clerk', 24: encodedAt, 26: share, 28: 'Outstanding', 31: 'Maria', 37: fidelity }); return row; };
  h.rows.Collections = [[],
    collection('COL-1', 'DPE-7', '2026-06-15T02:00:00.000Z', 350, 300, 20),
    collection('COL-2', 'DPE-7', '2026-06-16T02:00:00.000Z', 700, 600),
    collection('COL-3', 'DPE-9', '2026-06-16T02:00:00.000Z', 999, 999),
  ];
  const sale = Array(44).fill(''); Object.assign(sale, { 0: 'SAL-1', 1: '2026-06-15T03:00:00.000Z', 2: 'AGDAO', 3: 'Maria', 21: 'DP-1', 26: 500, 30: '2026-06-15', 32: 'DPE-7', 33: 'Clerk', 34: '2026-06-15T03:00:00.000Z', 35: 'Outstanding', 41: 450 });
  h.rows.Sales = [[], sale];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program']];
  const expense = Array(21).fill(''); Object.assign(expense, { 0: 'EXP-1', 1: '2026-06-16', 2: 'Fare', 4: 100, 11: 'Posted', 18: 'DPE-7' });
  h.rows.Expenses = [[], expense];
  await h.sync();
  const { buildClerkReport } = h.load('lib/clerk-report.ts');
  const report = await buildClerkReport('weekly', '2026-06-17', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(report.reportName, 'WEEKLY REPORT');
  assert.equal(report.dateLine, 'WEEK 3 JUNE 15-21, 2026');
  assert.equal(report.summaryLabel, '3RD WEEKLY REPORT');
  assert.deepEqual(report.collection.rows.map((row) => [row.label, row.accounts, row.gross, row.incentives, row.net, row.fidelity]), [['6/15/2026', 1, 350, 50, 300, 20], ['6/16/2026', 1, 700, 100, 600, 0]], 'by date; the other clerk\'s COL-3 is not counted');
  assert.deepEqual([report.newSales.total.accounts, report.newSales.total.gross, report.newSales.total.incentives], [1, 500, 50]);
  assert.deepEqual(report.cash, { cashBeg: 0, salesNet: 450, collectionNet: 900, fidelity: 20, pendingCash: 0, totalCashIn: 1370, expenses: 100, forwardedToBank: 0, totalCashOut: 100, remainingCashOnHand: 1270, totals: 1370 });
  assert.deepEqual(report.masSummary.rows.map((row) => [row.name, row.sales.accounts, row.collections.accounts, row.collections.gross]), [['Maria', 1, 2, 1050]]);
  // The next week starts with what was left: Cash Beg carries the remaining cash on hand.
  const next = await buildClerkReport('weekly', '2026-06-24', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(next.cash.cashBeg, 1270);
  assert.equal(next.cash.remainingCashOnHand, 1270);
  assert.equal(report.checks.withPhoto, 0);
  const daily = await buildClerkReport('daily', '2026-06-15', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.deepEqual(daily.collection.rows.map((row) => row.label), ['Maria'], 'a day is grouped by MAS');
});

test('receipt photos must be small compressed images and may cover several entries', async () => {
  const h = harness();
  const { saveReceiptPhoto, MAX_PHOTO_BYTES } = h.load('lib/receipt-photos.ts');
  await assert.rejects(() => h.load('lib/encoder-context.ts').runAsSystem(() => saveReceiptPhoto({ entryIds: ['COL-1'], dataUrl: 'data:image/png;base64,AAAA', width: 10, height: 10 })), /WebP or JPEG/);
  const big = 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES + 1000) * 4 / 3));
  await assert.rejects(() => h.load('lib/encoder-context.ts').runAsSystem(() => saveReceiptPhoto({ entryIds: ['COL-1'], dataUrl: `data:image/webp;base64,${big}`, width: 10, height: 10 })), /limit is 80 KB/);
  const data = 'A'.repeat(60000);
  const saved = await h.load('lib/encoder-context.ts').runAsSystem(() => saveReceiptPhoto({ entryIds: ['COL-1', 'COL-2', 'COL-1'], dataUrl: `data:image/webp;base64,${data}`, width: 800, height: 1000 }));
  assert.deepEqual(saved.entryIds, ['COL-1', 'COL-2']);
  const row = h.writes.find((write) => String(write.range).startsWith("'Receipt Photos'!A:N")).requestBody.values[0];
  assert.equal(row[1], 'COL-1,COL-2');
  assert.equal(row[9], 2, 'split into two cells under the 50,000-character limit');
  assert.equal(row[10].length + row[11].length, 60000);
});

test('bank deposits count as cash out, pending cash counts only in its own report, and remaining cash carries over', async () => {
  const h = harness();
  const collection = Array(41).fill(''); Object.assign(collection, { 0: 'COL-1', 5: 'DP-1', 7: 'Maria', 9: '2026-09-03', 10: 1000, 19: 'Posted', 20: '2026-09-03T02:00:00.000Z', 22: 'DPE-7', 24: '2026-09-03T02:00:00.000Z', 26: 900, 28: 'Outstanding', 31: 'Maria' });
  h.rows.Collections = [[], collection];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program']];
  h.rows['Bank Deposits'] = [[],
    ['DEP-1', '2026-09-03', 'DPE-7', 'Clerk', 'AGDAO', 'DSRDPI', 700, 'RCBC', 'Maria', '', 'Posted', '', ''],
    ['DEP-2', '2026-09-03', 'DPE-7', 'Clerk', 'AGDAO', 'DSRDPI', 50, 'RCBC', '', '', 'Voided', 'Typed twice', ''],
  ];
  h.rows['Report Notes'] = [[], ['DPE-7|daily|2026-09-03', 'DPE-7', 'daily', '2026-09-03', 120, 'Penalty paid', '', '220 - COH', '', '']];
  await h.sync();
  const { buildClerkReport } = h.load('lib/clerk-report.ts');
  const day = await buildClerkReport('daily', '2026-09-03', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.deepEqual(day.deposits.map((item) => [item.id, item.amount, item.transferType]), [['DEP-1', 700, 'RCBC']], 'a voided deposit is left out');
  assert.deepEqual([day.cash.collectionNet, day.cash.pendingCash, day.cash.totalCashIn, day.cash.forwardedToBank, day.cash.remainingCashOnHand], [900, 120, 1020, 700, 320]);
  assert.equal(day.notes.specificRemarks, 'Penalty paid');
  const nextDay = await buildClerkReport('daily', '2026-09-04', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(nextDay.cash.cashBeg, 200, 'carried: 900 in less 700 deposited; pending cash is not carried because it is encoded later');
});

test('changing an Employee ID rewrites every Employee ID column and refuses an ID already in use', async () => {
  const h = harness();
  // In the database: the employees, collections they are accountable for or encoded, and a report note keyed by the ID.
  await seed('employees', [{ employee_id: 'LEG-2026-0001', full_name: 'Solon, K.' }, { employee_id: 'MD-2026-0009', full_name: 'Other' }]);
  await seedAccount();
  const collection = (id, or, encoder, accountable) => ({ collection_id: id, collection_batch_id: 'CBT-1', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', or_number: or, amount_collected: 100, status: 'Posted', encoded_by_employee_id: encoder, accountable_employee_id: accountable });
  await seed('collections', [collection('COL-1', 'OR-1', 'MD-2026-0009', 'LEG-2026-0001'), collection('COL-2', 'OR-2', 'LEG-2026-0001', 'LEG-2026-0001'), collection('COL-3', 'OR-3', 'MD-2026-0009', 'MD-2026-0009')]);
  await seed('report_notes', [{ note_key: 'LEG-2026-0001|daily|2026-10-01', employee_id: 'LEG-2026-0001' }, { note_key: 'MD-2026-0009|daily|2026-10-01', employee_id: 'MD-2026-0009' }]);
  // Still in the sheets: the sign-in account and the clerk's report notes.
  h.rows.Users = [['user_id', 'employee_id'], ['USR-1', 'LEG-2026-0001']];
  h.rows["'Users'!B:B"] = [['employee_id'], ['LEG-2026-0001']];
  h.rows['Report Notes'] = [['note_key'], ['LEG-2026-0001|daily|2026-10-01'], ['MD-2026-0009|daily|2026-10-01']];
  const { changeEmployeeId } = h.load('lib/employee-id-change.ts');
  const run = (next) => h.load('lib/encoder-context.ts').runAsSystem(() => changeEmployeeId('LEG-2026-0001', next, 'Real ID assigned'));
  await assert.rejects(() => run('MD-2026-0009'), /already used/);
  await assert.rejects(() => run('bad-id'), /company format/);
  const result = await run('md-2026-0042');
  assert.equal(result.newId, 'MD-2026-0042');
  // Database: the employee row (linked columns follow it), the encoder column, and the report note key.
  assert.deepEqual(result.bySheet, { employees: 1, collections: 1, report_notes: 1, Users: 1, 'Report Notes': 1 });
  assert.deepEqual((await query('select employee_id from employees order by employee_id')).map((row) => row.employee_id), ['MD-2026-0009', 'MD-2026-0042']);
  assert.deepEqual(await query('select collection_id, encoded_by_employee_id, accountable_employee_id from collections order by collection_id'), [
    { collection_id: 'COL-1', encoded_by_employee_id: 'MD-2026-0009', accountable_employee_id: 'MD-2026-0042' },
    { collection_id: 'COL-2', encoded_by_employee_id: 'MD-2026-0042', accountable_employee_id: 'MD-2026-0042' },
    { collection_id: 'COL-3', encoded_by_employee_id: 'MD-2026-0009', accountable_employee_id: 'MD-2026-0009' },
  ], 'every reference moves, and nothing of the other employee');
  assert.deepEqual(await query('select note_key, employee_id from report_notes order by note_key'), [
    { note_key: 'MD-2026-0009|daily|2026-10-01', employee_id: 'MD-2026-0009' },
    { note_key: 'MD-2026-0042|daily|2026-10-01', employee_id: 'MD-2026-0042' },
  ]);
  // Sheets: only the tabs that are still there.
  const ranges = h.writes.filter((write) => write.requestBody?.data).flatMap((write) => write.requestBody.data.map((item) => `${item.range}=${item.values[0][0]}`));
  assert.deepEqual([...ranges].sort(), ["'Report Notes'!A2=MD-2026-0042|daily|2026-10-01", "'Users'!B2=MD-2026-0042"]);
});

test('entries go to Pending Approval on their own once every receipt photo is attached, and clerks see only theirs', async () => {
  const setup = (photos) => {
    const h = harness({ userId: 'USR-7', employeeId: 'DPE-7', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
    const collection = (id, encoder) => { const row = Array(41).fill(''); Object.assign(row, { 0: id, 1: 'CBT-1', 6: 'BR-1', 7: 'Maria', 9: '2026-09-25', 10: 350, 19: 'Posted', 22: encoder, 23: encoder === 'DPE-7' ? 'Clerk' : 'Other', 24: '2026-09-25T02:00:00.000Z', 26: 300, 28: 'Outstanding', 30: 'DPE-2', 31: 'Maria', 32: 'MAS', 40: '2026-09-25' }); return row; };
    const other = collection('COL-X', 'DPE-8'); other[1] = 'CBT-2';
    const collectionsHeader = Array(41).fill(''); collectionsHeader[28] = 'Remittance Status';
    const remittancesHeader = Array(28).fill(''); remittancesHeader[12] = 'Difference';
    h.rows.Collections = [collectionsHeader, collection('COL-A', 'DPE-7'), collection('COL-B', 'DPE-7'), other];
    h.rows.Remittances = [remittancesHeader];
    h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
    h.rows['Receipt Photos'] = [[], ...photos.map((ids, index) => [`RCP-${index}`, ids])];
    deadlineHeaders(h);
    return h;
  };
  // One of the batch's two Collections has no photo yet: nothing is sent.
  const partial = setup(['COL-A']);
  assert.deepEqual(await partial.load('lib/remittance-workflow.ts').submitReadyEntries(['COL-A']), []);
  assert.equal(partial.writes.length, 0);
  // With both photos the batch goes as one slip, expecting exactly the company share.
  const ready = setup(['COL-A,COL-B']);
  const slips = await ready.load('lib/remittance-workflow.ts').submitReadyEntries(['COL-A']);
  assert.equal(slips.length, 1);
  const requests = ready.writes.at(-1).requestBody.requests;
  const row = requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.deepEqual([row[4], row[10], row[11], row[12], row[8]], ['Pending Approval', 600, 600, 0, 'System']);
  assert.match(row[22], /Submitted automatically .* encoded by Clerk/);
  // The clerk's Remittances page shows only what they encoded; an approver sees everyone and can filter.
  const own = await (await ready.load('app/api/remittances/route.ts').GET()).json();
  assert.deepEqual(own.outstanding.map((item) => item.id).sort(), ['COL-A', 'COL-B']);
  assert.equal(own.canApprove, false);
  ready.setUser({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Approver', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const all = await (await ready.load('app/api/remittances/route.ts').GET()).json();
  assert.deepEqual(all.outstanding.map((item) => item.id).sort(), ['COL-A', 'COL-B', 'COL-X']);
  assert.deepEqual(all.clerks.map((item) => item.employeeId), ['DPE-7', 'DPE-8']);
});

test('the Sheets API answered from the database reads, appends, updates and deletes like a sheet tab', async () => {
  const h = harness();
  const { sheetsOnDb, parseA1 } = h.load('lib/sheets-on-db.ts');
  assert.deepEqual(parseA1("'Member programs'!S5"), { title: 'Member programs', c1: 18, c2: 18, r1: 5, r2: 5 });
  assert.deepEqual(parseA1('Collections!A:AO'), { title: 'Collections', c1: 0, c2: 40, r1: 1, r2: Infinity });
  assert.deepEqual(parseA1("'Users'!1:1"), { title: 'Users', c1: 0, c2: Infinity, r1: 1, r2: 1 });
  const { values } = sheetsOnDb.spreadsheets;
  await seed('programs', [{ program_id: 'DP-1', program_name: 'Plan', base_pay: 350, registration_fee_required: true }]);
  // Header row and typed values, as Sheets returns them.
  const read = (await values.get({ range: "'Programs'!A:L", valueRenderOption: 'UNFORMATTED_VALUE' })).data.values;
  assert.deepEqual(read[0].slice(0, 4), ['program_id', 'program_code', 'program_name', 'base_pay']);
  assert.deepEqual([read[1][0], read[1][2], read[1][3], read[1][10]], ['DP-1', 'Plan', 350, true]);
  assert.equal((await values.get({ range: "'Programs'!K2" })).data.values[0][0], 'TRUE', 'formatted booleans read TRUE/FALSE');
  // Append in sheet column order; text written with a leading apostrophe is literal; dates and numbers are typed.
  await h.load('lib/encoder-context.ts').runAsSystem(async () => {
    await values.append({ range: "'Holidays'!A:E", valueInputOption: 'USER_ENTERED', requestBody: { values: [['HOL-1', '2026-12-25', "'=Christmas", 'Regular', ''], ['HOL-2', '12/30/2026', 'Rizal Day', 'Regular', 'note']] } });
    assert.deepEqual((await values.get({ range: "'Holidays'!A2:D3" })).data.values, [['HOL-1', '2026-12-25', '=Christmas', 'Regular'], ['HOL-2', '2026-12-30', 'Rizal Day', 'Regular']]);
    // Row numbers follow the order rows were added, as in the sheet.
    await values.update({ range: "'Holidays'!C3", valueInputOption: 'RAW', requestBody: { values: [['Rizal Day (observed)']] } });
    await values.batchUpdate({ requestBody: { valueInputOption: 'RAW', data: [{ range: "'Holidays'!E2", values: [['moved']] }] } });
    assert.deepEqual((await query('select holiday_id, name, notes from holidays order by row_seq')), [{ holiday_id: 'HOL-1', name: '=Christmas', notes: 'moved' }, { holiday_id: 'HOL-2', name: 'Rizal Day (observed)', notes: 'note' }]);
    // The edit is in the Audit Log with the acting user (System here).
    assert.ok((await query("select user_name from audit_log where table_name = 'holidays'")).every((row) => row.user_name === 'System'));
    // Deleting sheet row 2 (index 1) removes the first data row.
    const tabs = (await sheetsOnDb.spreadsheets.get()).data.sheets;
    const sheetId = tabs.find((tab) => tab.properties.title === 'Holidays').properties.sheetId;
    await sheetsOnDb.spreadsheets.batchUpdate({ requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 } } }] } });
    assert.deepEqual((await query('select holiday_id from holidays')).map((row) => row.holiday_id), ['HOL-2']);
  });
});

test('Notices to Explain: three in force make the employee subject to suspension; expired and withdrawn ones do not count', async () => {
  const h = harness({ userId: 'U1', employeeId: 'MD-1', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  h.rows.Employees = [[], ['MD-5', 'Ana Cruz', 'MATINA', 'MAS', 'active']];
  const route = h.load('app/api/nte/route.ts');
  const today = h.load('lib/remittance-deadline.ts').manilaNow().date;
  const daysAgo = (days) => new Date(Date.parse(`${today}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const issue = async (issuedOn, reason) => (await route.POST(request({ employeeId: 'MD-5', issuedOn, reason }))).json();
  assert.match((await issue(today, '')).message, /reason/);
  await issue(daysAgo(91), 'Old notice');            // expired: issued more than 90 days ago
  await issue(daysAgo(40), 'Late remittance');
  const second = await issue(daysAgo(10), 'Missing receipt photos');
  let data = await (await route.GET()).json();
  assert.deepEqual(data.standing.map((item) => [item.employeeId, item.active, item.subjectToSuspension]), [['MD-5', 2, false]]);
  assert.equal(data.notices.find((nte) => nte.reason === 'Old notice').status, 'Expired');
  const third = await issue(today, 'Unexplained absence');
  data = await (await route.GET()).json();
  assert.deepEqual(data.standing.map((item) => [item.active, item.subjectToSuspension]), [[3, true]], 'three in force: subject to suspension');
  // Withdrawing one (issued by mistake) takes the employee back below the threshold.
  assert.equal((await route.PATCH(request({ id: second.id, reason: 'Issued to the wrong person' }))).status, 200);
  data = await (await route.GET()).json();
  assert.deepEqual(data.standing.map((item) => [item.active, item.subjectToSuspension]), [[2, false]]);
  assert.ok(third.id);
  // Only administrators.
  h.setUser({ userId: 'U2', employeeId: 'MD-2', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.GET()).status, 403);
});

test('an administrator can mark an employee Day Off in Attendance Review', async () => {
  const h = harness({ userId: 'U1', employeeId: 'MD-1', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true, manageAttendance: true } });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-5', 'MD-5', 'Ana Cruz', 'x', 'active', '', '']];
  h.rows.Employees = [[], ['MD-5', 'Ana Cruz', 'MATINA', 'MAS', 'active']];
  h.rows.Attendance = [['attendance_id']];
  const route = h.load('app/api/attendance-reviews/route.ts');
  const response = await route.POST(request({ employeeId: 'MD-5', attendanceDate: '2026-10-05', status: 'Day Off', notes: 'Rest day' }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.record.status, 'Day Off');
  const saved = h.writes.find((write) => String(write.range).startsWith('Attendance!') || String(write.range).startsWith("'Attendance'!"));
  assert.ok(saved && JSON.stringify(saved.requestBody.values).includes('Day Off'), 'the record is saved as Day Off');
  assert.equal((await route.POST(request({ employeeId: 'MD-5', attendanceDate: '2026-10-05', status: 'Holiday' }))).status, 400, 'only Absent, AWOL and Day Off');
});

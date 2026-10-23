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
  // Tests about other rules treat every MAS as cleared; the Clearing test below switches this off (lib/clearing.ts).
  globalThis.dayongClearingNotRequired = true;
  // Receipt photo files: an in-memory stand-in for Supabase Storage.
  globalThis.dayongTestStorage = new Map();
});
beforeEach(async () => {
  const { rows } = await pglite.query("select string_agg(format('%I', tablename), ', ') as names from pg_tables where schemaname = 'public'");
  await pglite.exec(`truncate ${rows[0].names} restart identity cascade`);
  globalThis.dayongTestStorage.clear();
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
  ['Receipt Photos', 'receipt_photos', 'photo_id', (r) => ({ photo_id: cell(r, 0), entry_ids: cell(r, 1) ?? '', mime_type: 'image/webp', storage_path: `test/${cell(r, 0)}.webp` })],
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
    for (const tab of ['Sales', 'Collections', 'Users', 'User Roles']) {
      const data = (rows[tab] ?? []).slice(1).filter((row) => row && row.length);
      const signature = JSON.stringify(data);
      // Unchanged since the last copy, or never given (and never copied): nothing to do.
      if (synced.get(`tab|${tab}`) === signature || (!data.length && !synced.has(`tab|${tab}`))) continue;
      await pglite.query(`delete from "${tab.toLowerCase().replace(/ /g, "_")}"`);
      // Repeated OR or application numbers (tests of duplicate checks) load flagged, as the October copy did.
      const keyColumn = tab === 'Collections' ? 8 : tab === 'Sales' ? 28 : -1;
      const seen = new Set();
      const extras = data.map((row) => { if (keyColumn < 0) return {}; const key = String(row[keyColumn] ?? '').toUpperCase().replace(/[^A-Z0-9]/g, ''); const repeat = Boolean(key) && seen.has(key); if (key) seen.add(key); return { legacy_duplicate: repeat }; });
      if (data.length) await load('lib/sheets-on-db.ts').appendSheetRows(tab, data, extras);
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
  const titles = ['Member programs', 'Members', 'Programs', 'Collections', 'Remittances', 'Remittance Collections', 'Sales', 'Beneficiaries', 'Branches', 'Employees', 'Employee Branches', 'Users', 'User Roles', 'Roles', 'Program Incentives', 'Receipt Photos', 'Bank Deposits', 'Report Notes', 'Attendance'];
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
      if (range.startsWith("'System Settings'")) return { data: { values: rows['System Settings'] ?? [[]] } };
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
      // Imports that name their extension (e.g. "@/lib/program-payment-limit.mjs") are loaded as written.
      const withExtension = (target) => (/\.m?[jt]s$/.test(target) ? target : `${target}.ts`);
      if (name.startsWith('@/')) return load(withExtension(name.slice(2)));
      if (name.startsWith('./')) return load(withExtension(path.posix.join(path.posix.dirname(file), name)));
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
  const entry = { branch: 'BALIOK', date: '2026-09-30', category: 'Others', categoryOther: 'Parking', amount: 150, attachments: ['Receipt', 'Voucher', 'Other'], attachmentOther: 'Gate pass', receiptNumber: 'OR-77', description: 'Client visit parking', approvedBy: 'CEO/President', remarks: '', photos: [{ dataUrl: `data:image/jpeg;base64,${'A'.repeat(4000)}`, width: 600, height: 800 }] };
  // A photo of the receipt is required (October 21, 2026); a refused expense saves no photo.
  const noPhoto = await route.POST(request({ ...entry, photos: [] }));
  assert.equal(noPhoto.status, 400);
  assert.match((await noPhoto.json()).message, /Attach a photo of the receipt/);
  assert.equal(globalThis.dayongTestStorage.size, 0);
  const missing = await route.POST(request(entry));
  assert.equal(missing.status, 400);
  assert.match((await missing.json()).message, /sheets:expense-fields/, 'saving before the migration explains how to fix it');
  h.rows['Expenses!V1:W1'] = [['attachments', 'approved_by']];
  const saved = await route.POST(request(entry));
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
  const write = h.writes.find((item) => item.range === "'Expenses'!A:W");
  assert.ok(write, 'the row spans the business, encoder, and form columns');
  const row = write.requestBody.values[0];
  assert.equal(row[2], 'Others: Parking');
  assert.equal(row[3], 'Client visit parking');
  assert.equal(row[6], 'Cash on Hand', 'paid from defaults to Cash on Hand');
  assert.deepEqual(row.slice(-2), ['Voucher, Receipt, Other: Gate pass', 'CEO/President']);
  assert.equal(globalThis.dayongTestStorage.size, 1, 'only the saved expense keeps a photo');
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
  // ₱320 month 1 plus a ₱500 registration fee.
  await seed('sales', [{ sale_id: 'SAL-1', member_number: 'PH-1', program_id: 'DP-1', amount_paid: 820, registration_amount: 500, application_no: 'APP-1', or_date: '2026-06-15' }]);
  const route = h.load('app/api/soa/route.ts');
  const list = await (await route.GET(new Request('http://localhost/api/soa'))).json();
  assert.deepEqual(list.accounts.map((item) => [item.id, item.memberName, item.programName]), [['ENR-1', 'Santos, Ana', 'DS-320']]);
  const response = await route.GET(new Request('http://localhost/api/soa?account=ENR-1'));
  const { statement } = await response.json();
  assert.equal(response.status, 200);
  assert.equal(statement.member.name, 'Ana Santos');
  assert.equal(statement.member.address, 'Mintal, Davao City');
  assert.deepEqual(statement.newSale.amount, 820);
  assert.deepEqual(statement.history.map((row) => [row.orNumber, row.monthFrom, row.monthTo, row.nopFrom, row.nopTo, row.runningTotal]), [['OR-100', '2026-07', '2026-08', 2, 3, 640]]);
  assert.equal(statement.summary.totalPaid, 960, 'latest NOP 3 × ₱320; the registration fee is not counted');
  assert.equal(statement.summary.monthsPaid, 3);
  assert.equal(statement.summary.nextNop, 4);
  assert.equal(statement.summary.nextMonth, '2026-09');
  assert.equal(statement.summary.remainingBalance, 18240, 'pay-the-balance total less Total paid (₱19,200 − ₱960)');
  // A flexible program has no fixed monthly amount: every amount paid is added up.
  await query("update programs set flexible = true where program_id = 'DP-1'");
  const flexible = (await (await route.GET(new Request('http://localhost/api/soa?account=ENR-1'))).json()).statement;
  assert.equal(flexible.summary.totalPaid, 1460, 'flexible: the New Sale and every collection');
  await query("update programs set flexible = false where program_id = 'DP-1'");
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

test('a program form left open cannot write its older values over a newer edit', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  const route = h.load('app/api/programs/route.ts');
  const { programSnapshot } = h.load('lib/program-snapshot.ts');
  h.rows.Programs = [[], ['DP-0001', 'P1', 'Plan One', 350, 'active', '']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-0001', 'MAS', 1, 12, 'percentage', 50, 30]];
  await h.sync();
  // Two people open the same program: both forms remember it as it is now.
  const programs = await (await route.GET()).json();
  const opened = programSnapshot(programs.programs.find((program) => program.id === 'DP-0001'));
  const tiers = [{ role: 'MAS', fromMonth: 1, toMonth: 12, incentiveType: 'percentage', markUp: 50, incentiveAmount: 30 }];
  const put = (body) => route.PUT(new Request('http://localhost/api/programs?id=DP-0001', { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  const first = await put({ code: 'P1', name: 'Plan One', basePay: 350, status: 'active', description: '', registrationFeeRequired: true, registrationAmount: 500, incentiveTiers: tiers, expectedSnapshot: opened });
  assert.equal(first.status, 200, 'the first save goes through');
  const second = await put({ code: 'P1', name: 'Plan One renamed', basePay: 350, status: 'active', description: '', registrationFeeRequired: false, incentiveTiers: tiers, expectedSnapshot: opened });
  assert.equal(second.status, 409, 'the form opened before that save is refused');
  assert.match((await second.json()).error, /changed by someone else/);
  const [row] = await query("select program_name, registration_fee_required, registration_amount from programs where program_id = 'DP-0001'");
  assert.deepEqual([row.program_name, row.registration_fee_required, Number(row.registration_amount)], ['Plan One', true, 500], 'the first edit is kept');
});

test('programs bulk edit sets only the chosen settings on every selected program, all or nothing', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', permissions: { manageUsers: true } });
  const route = h.load('app/api/programs/route.ts');
  h.rows.Programs = [[], ['DP-0001', 'P1', 'Plan One', 350, 'active', ''], ['DP-0002', 'P2', 'Plan Two', 200, 'active', ''], ['DP-0003', 'P3', 'Plan Three', 500, 'active', '']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-0001', 'MAS', 1, 12, 'percentage', 50, 30]];
  await h.sync();
  await seed('program_categories', [{ category_id: 'CAT-1', category_name: 'Funeral Services', status: 'active' }]);
  const patch = (body) => route.PATCH(new Request('http://localhost/api/programs', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  const ok = await patch({ ids: ['DP-0001', 'DP-0002'], changes: { categoryId: 'CAT-1', collectionAmountEditable: true, flexible: true } });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).updated, 2);
  const rows = await query("select program_id, program_name, base_pay, category_id, collection_amount_editable, flexible from programs order by program_id");
  assert.deepEqual(rows.map((row) => [row.program_id, row.program_name, Number(row.base_pay), row.category_id, row.collection_amount_editable, row.flexible]), [
    ['DP-0001', 'Plan One', 350, 'CAT-1', true, true], ['DP-0002', 'Plan Two', 200, 'CAT-1', true, true], ['DP-0003', 'Plan Three', 500, null, false, false],
  ], 'names and base pay stay; the unselected program is untouched');
  assert.equal((await query("select count(*)::int as n from program_incentives where program_id = 'DP-0001'"))[0].n, 1, 'incentive tiers are not touched');
  // A monthly maximum of 300 is below Plan One's 350 base pay: nothing is saved, and the error names the program.
  const failed = await patch({ ids: ['DP-0001', 'DP-0002'], changes: { maxMonthlyPayment: 300 } });
  assert.equal(failed.status, 400);
  assert.match((await failed.json()).error, /^P1: /);
  assert.deepEqual((await query("select max_monthly_payment from programs where program_id = 'DP-0002'"))[0].max_monthly_payment, null, 'Plan Two was not saved either');
  assert.equal((await patch({ ids: [], changes: { status: 'inactive' } })).status, 400);
  h.setUser({ userId: 'U2', employeeId: 'DPE-0002', name: 'mas', roleNames: ['MAS'], permissions: {} });
  assert.equal((await patch({ ids: ['DP-0001'], changes: { status: 'inactive' } })).status, 403);
});

test('every application table announces its changes for live updates, and saves never depend on it', async () => {
  harness();
  const [tables] = await query("select count(*)::int as n from pg_tables where schemaname = 'public' and tablename <> 'audit_log'");
  const [triggers] = await query("select count(distinct tgrelid)::int as n from pg_trigger where tgname = 'notify_table_change' and not tgisinternal");
  assert.equal(triggers.n, tables.n, 'one statement trigger per table (audit_log excluded)');
  // PGlite has no Supabase realtime schema: the trigger does nothing and the write goes through.
  await seed('program_categories', [{ category_id: 'CAT-LIVE', category_name: 'Live', status: 'active' }]);
  assert.equal((await query("select count(*)::int as n from program_categories where category_id = 'CAT-LIVE'"))[0].n, 1);
});

test('collection links follow name changes and stay empty for unknown names', async () => {
  harness();
  await seedAccount();
  await seed('branches', [{ branch_id: 'BR-9', branch_name_code: 'Toril' }]);
  await seed('employees', [{ employee_id: 'DPE-0009', full_name: 'Ana Reyes' }]);
  const [enrollment] = await query('select enrollment_id, member_id, program_id from member_programs limit 1');
  await seed('collections', [{ collection_id: 'COL-L1', collection_batch_id: 'CBT-L', enrollment_id: enrollment.enrollment_id, member_id: enrollment.member_id, program_id: enrollment.program_id, branch: ' toril ', mas: 'ANA REYES', amount_collected: 350, status: 'Posted' }]);
  const links = async () => (await query("select branch_id, mas_employee_id from collections where collection_id = 'COL-L1'"))[0];
  assert.deepEqual(await links(), { branch_id: 'BR-9', mas_employee_id: 'DPE-0009' }, 'case and spaces are ignored');
  await query("update collections set mas = 'DTO' where collection_id = 'COL-L1'");
  assert.deepEqual(await links(), { branch_id: 'BR-9', mas_employee_id: null }, 'a name that matches no employee leaves the link empty');
  await query("update collections set mas = 'Lito Cruz' where collection_id = 'COL-L1'");
  assert.equal((await links()).mas_employee_id, null);
  await seed('employees', [{ employee_id: 'DPE-0010', full_name: 'Lito Cruz' }]);
  assert.equal((await links()).mas_employee_id, 'DPE-0010', 'registering the employee links collections waiting under that name');
  await query("update branches set branch_id = 'BR-10' where branch_id = 'BR-9'");
  assert.equal((await links()).branch_id, 'BR-10', 'a changed branch ID follows through');
});

test('renaming a branch or employee updates every copy of the name, logged once', async () => {
  harness();
  await seedAccount();
  await seed('branches', [{ branch_id: 'BR-7', branch_name_code: 'Mintal' }]);
  await seed('employees', [{ employee_id: 'DPE-0007', full_name: 'Rosa Lim' }, { employee_id: 'DPE-0008', full_name: 'Twin Name' }, { employee_id: 'DPE-0009', full_name: 'Twin Name' }]);
  const [enrollment] = await query('select enrollment_id, member_id, program_id from member_programs limit 1');
  await query("update member_programs set branch = 'Mintal', mas = 'Rosa Lim' where enrollment_id = $1", [enrollment.enrollment_id]);
  await seed('collections', [
    { collection_id: 'COL-R1', collection_batch_id: 'CBT-R', enrollment_id: enrollment.enrollment_id, member_id: enrollment.member_id, program_id: enrollment.program_id, branch: 'Mintal', mas: 'Rosa Lim', accountable_employee_id: 'DPE-0007', accountable_name: 'Rosa Lim', amount_collected: 350, status: 'Posted' },
    { collection_id: 'COL-R2', collection_batch_id: 'CBT-R', enrollment_id: enrollment.enrollment_id, member_id: enrollment.member_id, program_id: enrollment.program_id, branch: 'Mintal', mas: 'Twin Name', original_mas: 'Twin Name', amount_collected: 350, status: 'Posted' },
  ]);
  const auditBefore = (await query('select count(*)::int as n from audit_log'))[0].n;
  await query("update branches set branch_name_code = 'Mintal Proper' where branch_id = 'BR-7'");
  await query("update employees set full_name = 'Rosa Lim-Santos' where employee_id = 'DPE-0007'");
  const rows = await query("select collection_id, branch, mas, accountable_name, branch_id, mas_employee_id from collections where collection_id in ('COL-R1', 'COL-R2') order by collection_id");
  assert.deepEqual(rows.map((row) => [row.branch, row.mas, row.accountable_name, row.branch_id, row.mas_employee_id]), [
    ['Mintal Proper', 'Rosa Lim-Santos', 'Rosa Lim-Santos', 'BR-7', 'DPE-0007'], ['Mintal Proper', 'Twin Name', null, 'BR-7', 'DPE-0008'],
  ], 'collections follow both renames and keep their links');
  assert.deepEqual((await query('select branch, mas from member_programs where enrollment_id = $1', [enrollment.enrollment_id]))[0], { branch: 'Mintal Proper', mas: 'Rosa Lim-Santos' }, 'the enrollment follows too, so its collections still match it');
  assert.deepEqual((await query("select action, table_name from audit_log order by row_seq")).slice(auditBefore).map((row) => row.table_name), ['branches', 'employees'], 'each rename is logged once, the copies are not');
  // Two employees shared "Twin Name": renaming one changes only the copies linked to that employee by ID.
  await query("update employees set full_name = 'Twin One' where employee_id = 'DPE-0008'");
  assert.deepEqual((await query("select mas, original_mas from collections where collection_id = 'COL-R2'"))[0], { mas: 'Twin One', original_mas: 'Twin Name' }, 'the name-only copy is left alone when the old name was shared');
});

test('sales, enrollments and attendance link to branch and MAS records, and late registrations link waiting rows', async () => {
  harness();
  await seedAccount();
  await seed('branches', [{ branch_id: 'BR-5', branch_name_code: 'Calinan' }]);
  await seed('employees', [{ employee_id: 'DPE-0005', full_name: 'Mila Cruz' }]);
  const [enrollment] = await query('select enrollment_id from member_programs limit 1');
  await query("update member_programs set branch = 'CALINAN', mas = 'Mila Cruz' where enrollment_id = $1", [enrollment.enrollment_id]);
  assert.deepEqual((await query('select branch_id, mas_employee_id from member_programs where enrollment_id = $1', [enrollment.enrollment_id]))[0], { branch_id: 'BR-5', mas_employee_id: 'DPE-0005' });
  await seed('attendance', [{ attendance_id: 'ATT-L1', employee_id: 'DPE-0005', attendance_date: '2026-10-07', branch: 'Calinan' }]);
  assert.equal((await query("select branch_id from attendance where attendance_id = 'ATT-L1'"))[0].branch_id, 'BR-5');
  // A name with no employee yet stays unlinked, then links as soon as that employee is registered.
  await query("update member_programs set mas = 'New Hire' where enrollment_id = $1", [enrollment.enrollment_id]);
  assert.equal((await query('select mas_employee_id from member_programs where enrollment_id = $1', [enrollment.enrollment_id]))[0].mas_employee_id, null);
  await seed('employees', [{ employee_id: 'DPE-0006', full_name: 'New Hire' }]);
  assert.equal((await query('select mas_employee_id from member_programs where enrollment_id = $1', [enrollment.enrollment_id]))[0].mas_employee_id, 'DPE-0006');
});

test('Gross Sales breakdown lists the New Sales and posted collections behind the figure, for executives and Finance only', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'ceo', roleNames: ['CEO'], permissions: {} });
  await seedAccount();
  const [enrollment] = await query('select enrollment_id, member_id, program_id from member_programs limit 1');
  // 23:30 UTC on Oct 4 is 7:30 AM on Oct 5 in Manila: the sale counts on Oct 5.
  await seed('sales', [{ sale_id: 'SAL-G1', date_created: '2026-10-04T23:30:00Z', branch: 'BR-1', mas: 'mas', member_number: 'PH-1', program_id: enrollment.program_id, application_no: 'APP-G1', amount_paid: 350, penalty_amount: 50 },
    { sale_id: 'SAL-G2', date_created: '2026-09-30T05:00:00Z', branch: 'BR-1', program_id: enrollment.program_id, amount_paid: 999 }]);
  const collection = (id, orDate, status, amount) => ({ collection_id: id, collection_batch_id: 'CBT-G', enrollment_id: enrollment.enrollment_id, member_id: enrollment.member_id, program_id: enrollment.program_id, branch: 'BR-2', mas: 'mas', or_number: id, or_date: orDate, amount_collected: amount, status });
  await seed('collections', [collection('OR-G1', '2026-10-05', 'Posted', 700), collection('OR-G2', '2026-10-06', 'Voided', 300), collection('OR-G3', '2026-11-01', 'Posted', 200)]);
  const route = h.load('app/api/dashboard/gross-sales/route.ts');
  const get = async (query) => { const response = await route.GET(new Request(`http://localhost/api/dashboard/gross-sales?${query}`)); return { status: response.status, body: response.headers.get('content-type')?.includes('csv') ? await response.text() : await response.json() }; };
  const { status, body } = await get('from=2026-10-01&to=2026-10-31');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual([body.totals.newSales, body.totals.penalties, body.totals.collections, body.totals.gross], [400, 50, 700, 1100], 'sale amount + penalty, posted collections only, inside the dates');
  assert.deepEqual(body.entries.map((row) => [row.kind, row.id, row.date]), [['Collection', 'OR-G1', '2026-10-05'], ['New Sale', 'SAL-G1', '2026-10-05']]);
  assert.deepEqual(body.branches.map((row) => [row.branch, row.total]), [['BR-2', 700], ['BR-1', 400]]);
  const filtered = (await get('from=2026-10-01&to=2026-10-31&kind=New%20Sale')).body;
  assert.deepEqual([filtered.filtered.count, filtered.filtered.total, filtered.totals.gross], [1, 400, 1100], 'filters narrow the list, not the overall total');
  assert.match((await get('from=2026-10-01&to=2026-10-31&format=csv')).body, /APP-G1/);
  h.setUser({ userId: 'U2', employeeId: 'DPE-0002', name: 'mas', roleNames: ['MAS'], permissions: {} });
  assert.equal((await get('from=2026-10-01&to=2026-10-31')).status, 403);
});

test('editing a member updates the copies on their sales, enrollments and collections; renames reach the login account', async () => {
  harness();
  await seedAccount();
  const [member] = await query('select member_id, member_number from members limit 1');
  await seed('sales', [{ sale_id: 'SAL-C1', member_number: member.member_number, surname: 'Old', first_name: 'Name', address: 'Old address', program_id: 'DP-1', amount_paid: 350 }]);
  const auditBefore = (await query('select count(*)::int as n from audit_log'))[0].n;
  await query("update members set surname = 'Santos', first_name = 'Ana', address = 'Blk 3, Toril', claimant_name = 'Pedro Santos', member_number = 'PH-NEW' where member_id = $1", [member.member_id]);
  assert.deepEqual((await query("select member_number, surname, first_name, address, claimant_name from sales where sale_id = 'SAL-C1'"))[0], { member_number: 'PH-NEW', surname: 'Santos', first_name: 'Ana', address: 'Blk 3, Toril', claimant_name: 'Pedro Santos' });
  assert.deepEqual([...new Set((await query('select member_number from member_programs where member_id = $1', [member.member_id])).map((row) => row.member_number))], ['PH-NEW']);
  assert.deepEqual((await query("select table_name from audit_log order by row_seq")).slice(auditBefore).map((row) => row.table_name), ['members'], 'one Audit Log entry, on the member');
  await seed('employees', [{ employee_id: 'DPE-0044', full_name: 'Joy Tan' }]);
  await seed('users', [{ user_id: 'U-44', employee_id: 'DPE-0044', full_name: 'Joy Tan', password_hash: 'x', status: 'active' }]);
  await query("update employees set full_name = 'Joy Tan-Reyes' where employee_id = 'DPE-0044'");
  assert.equal((await query("select full_name from users where user_id = 'U-44'"))[0].full_name, 'Joy Tan-Reyes', 'the login account shows the new name');
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

test('attendance sheet lists every day and totals what payroll counts', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', name: 'finance', roleNames: ['Finance'], permissions: {} });
  const { attendanceSheet, sumSummaries } = h.load('lib/attendance-sheet.ts');
  const day = (date, values = {}) => ({ id: `ATT-${date}`, employeeId: 'E1', attendanceDate: date, branch: 'MATINA', scheduledTimeIn: '08:00', scheduledTimeOut: '17:00', timeIn: '', timeOut: '', workedHours: 0, overtimeHours: 0, status: 'Present', lateMinutes: 0, undertimeMinutes: 0, leaveType: '', leaveApprovalStatus: '', notes: '', createdAt: '', updatedAt: '', ...values });
  const records = [
    day('2026-10-02', { timeIn: '08:00', timeOut: '17:00' }),
    day('2026-10-03', { timeIn: '08:30', timeOut: '17:00', lateMinutes: 10 }),
    day('2026-10-04', { timeIn: '09:00', timeOut: '12:00', undertimeMinutes: 240 }),
    day('2026-10-06', { status: 'Absent', notes: 'Absent by system: no clock-in by 11:59 PM and not marked by management.' }),
    day('2026-10-09', { status: 'Leave', leaveType: 'Vacation', leaveApprovalStatus: 'Pending' }),
  ];
  const { days, summary } = attendanceSheet({
    employee: { branch: 'MATINA', dateHired: '2026-10-02' }, records,
    declaredDays: [{ date: '2026-10-05', allBranches: true, branchNames: [] }], from: '2026-10-01', to: '2026-10-10', today: '2026-10-08',
  });
  assert.deepEqual(days.map((item) => item.status), ['Before hire', 'Present', 'Late', 'Present', 'Non-working day', 'Absent (system)', 'No record', 'Not clocked in', 'Leave', 'Upcoming']);
  assert.equal(days[3].restDayWork, true, 'worked on a Sunday');
  // Working days so far: Oct 2, 3, 6, 7 (Oct 1 before hire, Sunday, the declared day and today not counted).
  assert.equal(summary.scheduledDays, 4);
  assert.deepEqual([summary.present, summary.restDayWork, summary.lateDays, summary.lateMinutes, summary.undertimeDays, summary.undertimeMinutes], [3, 1, 1, 10, 1, 240]);
  assert.deepEqual([summary.absent, summary.systemAbsent, summary.noRecord, summary.approvedLeave, summary.otherLeave], [1, 1, 1, 0, 1]);
  assert.equal(summary.daysPayable, 3, 'present + approved leave, as payroll counts');
  assert.equal(summary.regularHours, 18.5);
  assert.equal(summary.attendanceRate, 50, 'two of four expected working days (the Sunday is extra)');
  assert.equal(sumSummaries([summary, summary]).present, 6);

  // The paper sheet's grid codes; a paper "P" (Present, no times) counts present, and paper time-ins are not flagged for a missing time-out.
  const { gridCell, PAPER_SHEET_NOTE } = h.load('lib/attendance-sheet.ts');
  assert.deepEqual(days.map((item) => gridCell(item).code), ['', '8:00', '8:30', '9:00', '', 'A', 'ND', '', 'L', '']);
  assert.equal(gridCell(days[2]).tone, 'late');
  assert.equal(gridCell(days[4]).tone, 'closed');
  const paper = attendanceSheet({
    employee: { branch: 'MATINA', dateHired: '' }, declaredDays: [], from: '2026-10-01', to: '2026-10-03', today: '2026-10-08',
    records: [day('2026-10-01', { notes: PAPER_SHEET_NOTE }), day('2026-10-02', { timeIn: '07:43', notes: `${PAPER_SHEET_NOTE} (time in only)` }), day('2026-10-03', { status: 'Day Off' })],
  });
  assert.deepEqual(paper.days.map((item) => gridCell(item).code), ['P', '7:43', 'RD']);
  assert.deepEqual([paper.summary.present, paper.summary.missingTimeOut, paper.summary.dayOff, paper.summary.daysPayable], [2, 0, 1, 2]);

  h.rows.Employees = [[], ['MD-2099-0101', 'Ana Santos', 'MATINA', 'MAS', 'active'], ['MD-2099-0102', 'Old Staff', 'MATINA', 'MAS', 'resigned']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-2099-0101', 'BR-1']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO DAVAO 1', '', '', '', '', '', '', '', '', '', 'active']];
  const attendance = Array(18).fill(''); attendance[0] = 'ATT-1'; attendance[1] = 'MD-2099-0101'; attendance[2] = '2026-09-15'; attendance[3] = 'MATINA'; attendance[6] = '08:05:00'; attendance[7] = '17:00:00'; attendance[8] = 8.92; attendance[9] = 0; attendance[10] = 'Present'; attendance[11] = 5;
  h.rows.Attendance = [[], attendance];
  const route = h.load('app/api/attendance-sheet/route.ts');
  const all = await (await route.GET(new Request('http://localhost/api/attendance-sheet?from=2026-09-01&to=2026-09-30'))).json();
  assert.equal(all.success, true, JSON.stringify(all));
  assert.deepEqual(all.rows.map((row) => row.employee.id), ['MD-2099-0101'], 'resigned staff without attendance are left out');
  assert.equal(all.rows[0].summary.present, 1);
  assert.equal(all.rows[0].summary.lateMinutes, 5);
  assert.equal(all.rows[0].cells.length, 30, 'one grid cell per day');
  assert.equal(all.rows[0].cells[14].code, '8:05');
  const one = await (await route.GET(new Request('http://localhost/api/attendance-sheet?from=2026-09-01&to=2026-09-30&employeeId=MD-2099-0101'))).json();
  assert.equal(one.days.length, 30, 'every day of the range');
  assert.equal(one.days.find((item) => item.date === '2026-09-15').status, 'Late');
  h.setUser({ userId: 'U2', employeeId: 'MD-2099-0101', name: 'ana', roleNames: ['MAS'], permissions: {} });
  assert.equal((await route.GET(new Request('http://localhost/api/attendance-sheet?from=2026-09-01&to=2026-09-30'))).status, 403);
});

test('an employee sees a Notice to Explain issued to them, confirms receipt and explains; others never see it', async () => {
  const admin = { userId: 'USR-9', employeeId: 'MD-2099-0900', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } };
  const h = harness(admin);
  h.rows.Employees = [[], ['MD-2099-0900', 'Admin Person', 'BR-1', 'Administrator', 'active'], ['MD-2099-0901', 'Rina Cruz', 'BR-1', 'MAS', 'active'], ['MD-2099-0902', 'Other Person', 'BR-1', 'MAS', 'active']];
  const issued = await h.load('app/api/nte/route.ts').POST(request({ employeeId: 'MD-2099-0901', reason: 'Late remittance', details: 'Remitted two days late.' }));
  assert.equal(issued.status, 201, JSON.stringify(await issued.clone().json()));
  const { id } = await issued.json();
  const mine = h.load('app/api/nte/mine/route.ts');
  const counts = async () => h.load('lib/notifications.ts').getNotificationCounts({ ...employee, permissions: {} });
  const patch = (body) => mine.PATCH(new Request('http://localhost/api/nte/mine', { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
  const employee = { userId: 'USR-10', employeeId: 'MD-2099-0901', name: 'rina', roleNames: ['MAS'], permissions: {} };

  h.setUser(employee);
  let list = await (await mine.GET()).json();
  assert.deepEqual(list.notices.map((nte) => [nte.id, nte.reason, nte.acknowledgedAt]), [[id, 'Late remittance', '']]);
  assert.equal((await counts())['/my-notices'], 1);
  assert.equal((await patch({ id, action: 'acknowledge' })).status, 200);
  assert.equal((await patch({ id, action: 'explain', explanation: 'x' })).status, 400);
  assert.equal((await patch({ id, action: 'explain', explanation: 'The bank was closed on the due date.' })).status, 200);
  list = await (await mine.GET()).json();
  assert.ok(list.notices[0].acknowledgedAt && list.notices[0].explainedAt);
  assert.equal((await counts())['/my-notices'], undefined);

  // Another employee neither sees nor answers it.
  h.setUser({ ...employee, userId: 'USR-11', employeeId: 'MD-2099-0902' });
  assert.equal((await (await mine.GET()).json()).notices.length, 0);
  assert.equal((await patch({ id, action: 'explain', explanation: 'Not mine to answer.' })).status, 400);

  // The administrator reads the reply; a withdrawn notice can no longer be answered.
  h.setUser(admin);
  const all = await (await h.load('app/api/nte/route.ts').GET()).json();
  assert.equal(all.notices.find((nte) => nte.id === id).explanation, 'The bank was closed on the due date.');
  // The explanation shows as a number on Employees until an administrator marks it reviewed.
  const adminCounts = () => h.load('lib/notifications.ts').getNotificationCounts(admin);
  assert.equal((await adminCounts())['/employees'], 1);
  const reviewed = await h.load('app/api/nte/route.ts').PATCH(new Request('http://localhost/api/nte', { method: 'PATCH', body: JSON.stringify({ id, action: 'reviewed' }), headers: { 'Content-Type': 'application/json' } }));
  assert.equal(reviewed.status, 200, JSON.stringify(await reviewed.clone().json()));
  assert.equal((await adminCounts())['/employees'], undefined, 'reviewed explanations leave the number');
  assert.ok((await (await h.load('app/api/nte/route.ts').GET()).json()).notices.find((nte) => nte.id === id).reviewedAt);
  await h.load('app/api/nte/route.ts').PATCH(new Request('http://localhost/api/nte', { method: 'PATCH', body: JSON.stringify({ id, reason: 'Issued by mistake' }), headers: { 'Content-Type': 'application/json' } }));
  h.setUser(employee);
  assert.equal((await patch({ id, action: 'explain', explanation: 'A revised reply.' })).status, 400);
});

test('a member without a contact number gets the claimant contact, when it is a real number', () => {
  const { memberContactOrClaimant } = harness().load('lib/member-records.ts');
  assert.equal(memberContactOrClaimant('', '0917 123 4567'), '0917 123 4567');
  assert.equal(memberContactOrClaimant('09181112222', '0917 123 4567'), '09181112222', 'the member own number wins');
  assert.equal(memberContactOrClaimant('', 'N/A'), '');
  assert.equal(memberContactOrClaimant(' ', '0'), '');
});

test('Programs → Transfer members moves, merges or leaves each account', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  await seed('programs', [{ program_id: 'DP-OLD', program_name: 'D-300 (NEW)', base_pay: 300 }, { program_id: 'DP-NEW', program_name: 'D-300 (Bracketing)', base_pay: 300 }, { program_id: 'DP-400', program_name: 'D-400', base_pay: 400 }]);
  await seed('members', [1, 2, 3].map((n) => ({ member_id: `MEM-${n}`, member_number: `PH-${n}`, surname: `S${n}`, first_name: 'A' })));
  await seed('member_programs', [
    { enrollment_id: 'E1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-OLD', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E2-OLD', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-OLD', doi: '2026-06-20', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E2-NEW', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-NEW', doi: '2026-06-10', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E3-OLD', member_id: 'MEM-3', member_number: 'PH-3', program_id: 'DP-OLD', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E3-NEW', member_id: 'MEM-3', member_number: 'PH-3', program_id: 'DP-NEW', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
  ]);
  const col = (id, enrollment, member, program, month, nop) => ({ collection_id: id, collection_batch_id: 'CBT', enrollment_id: enrollment, member_id: member, member_number: member.replace('MEM', 'PH'), program_id: program, or_number: id, or_date: `${month}-05`, amount_collected: 300, month_from: month, month_to: month, nop_from: nop, nop_to: nop, status: 'Posted' });
  await seed('collections', [
    col('C1', 'E1', 'MEM-1', 'DP-OLD', '2026-07', 2),
    col('C2a', 'E2-NEW', 'MEM-2', 'DP-NEW', '2026-07', 2), col('C2b', 'E2-NEW', 'MEM-2', 'DP-NEW', '2026-08', 3), col('C2c', 'E2-OLD', 'MEM-2', 'DP-OLD', '2026-09', 2),
    col('C3a', 'E3-NEW', 'MEM-3', 'DP-NEW', '2026-07', 2), col('C3b', 'E3-OLD', 'MEM-3', 'DP-OLD', '2026-07', 2),
  ]);
  const route = h.load('app/api/programs/transfer/route.ts');
  const options = await (await route.GET(new Request('http://localhost/api/programs/transfer?program=DP-OLD'))).json();
  assert.deepEqual(options.targets.map((item) => item.id), ['DP-NEW', 'DP-400'], 'any other program, whatever its pay');
  const targetsOnly = await (await route.GET(new Request('http://localhost/api/programs/transfer?targets=1&program=DP-OLD'))).json();
  assert.deepEqual([targetsOnly.targets.map((item) => item.id), targetsOnly.accounts], [['DP-NEW', 'DP-400'], undefined], 'Members -> Transfer lists only the programs');
  assert.equal(options.accounts.length, 3);
  const post = (body) => route.POST(request(body));
  const notWhole = await (await post({ from: 'DP-OLD', to: 'DP-400', all: true, reason: 'test' })).json();
  assert.deepEqual([notWhole.moved, notWhole.merged, notWhole.left.length], [0, 0, 3], 'P300 receipts are not whole P400 months: every account is left');
  assert.match(notWhole.left[0].why, /not a whole number of ₱400 months/);
  const missingTier = await (await post({ from: 'DP-OLD', to: 'DP-NEW', all: true, reason: 'Same plan' })).json();
  assert.match(missingTier.message, /Cannot recalculate incentives/);
  assert.equal((await query("select program_id from member_programs where enrollment_id='E1'"))[0].program_id, 'DP-OLD', 'a missing tier rolls back the program/account move');
  assert.equal((await query("select count(*)::int as n from member_programs where enrollment_id='E2-OLD'"))[0].n, 1, 'merged source account also survives rollback');
  await seed('program_incentives', [{ incentive_id: 'NEW-MAS', program_id: 'DP-NEW', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'fixed', mark_up: 0, incentive_amount: 75 }]);
  const response = await post({ from: 'DP-OLD', to: 'DP-NEW', all: true, removeWhenEmpty: true, reason: 'Same plan' });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  // Owner, October 16, 2026: a member whose target account already has payments is merged too (E3: both paid July).
  assert.deepEqual([result.moved, result.merged, result.left.map((item) => item.enrollmentId), result.removal], [1, 2, [], 'deleted']);
  const enrollments = await query("select enrollment_id, program_id, doi::text as doi from member_programs order by enrollment_id");
  assert.deepEqual(enrollments.map((row) => [row.enrollment_id, row.program_id]), [['E1', 'DP-NEW'], ['E2-NEW', 'DP-NEW'], ['E3-NEW', 'DP-NEW']], 'E2-OLD and E3-OLD merged away');
  assert.equal(enrollments.find((row) => row.enrollment_id === 'E2-NEW').doi, '2026-06-10', 'the earlier DOI is kept');
  const merged = await query("select collection_id, enrollment_id, nop_from from collections where member_id = 'MEM-2' order by month_from");
  assert.deepEqual(merged.map((row) => [row.collection_id, row.enrollment_id, row.nop_from]), [['C2a', 'E2-NEW', 2], ['C2b', 'E2-NEW', 3], ['C2c', 'E2-NEW', 4]], 'payments joined and numbered on from NOP 2');
  assert.deepEqual(await query("select collection_id, remittance_amount::float8 as share from collections where collection_id in ('C1','C2a','C2b','C2c') order by collection_id"), ['C1','C2a','C2b','C2c'].map(collection_id => ({collection_id, share:225})), 'moved and merged histories use target incentives');
  const both = await query("select collection_id, enrollment_id, nop_from, month_from from collections where member_id = 'MEM-3' order by nop_from");
  assert.deepEqual(both.map((row) => [row.collection_id, row.enrollment_id, row.nop_from, row.month_from]), [['C3a', 'E3-NEW', 2, '2026-07'], ['C3b', 'E3-NEW', 3, '2026-08']], 'both July payments joined, numbered on in OR-date order');
  assert.equal((await query("select count(*)::int as n from programs where program_id = 'DP-OLD'"))[0].n, 0, 'nothing uses the emptied program, so it is deleted');
  h.setUser({ userId: 'USR-1', employeeId: 'DPE-1', name: 'clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.GET(new Request('http://localhost/api/programs/transfer?program=DP-NEW'))).status, 403, 'administrators only');
});

test('Transfer members to a program with a different pay counts each receipt again in the new monthly pay', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  await seed('programs', [{ program_id: 'DP-300', program_name: 'D-300', base_pay: 300 }, { program_id: 'DP-150', program_name: 'D-150', base_pay: 150 }, { program_id: 'DP-FLEX', program_name: 'D-210 HG', base_pay: 200, flexible: true }]);
  await seed('members', [1, 2, 3].map((n) => ({ member_id: `MEM-${n}`, member_number: `PH-${n}`, surname: `S${n}`, first_name: 'A' })));
  await seed('member_programs', [
    { enrollment_id: 'E1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-300', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E2', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-300', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E2-150', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-150', doi: '2026-05-15', branch: 'BR-1', mas: 'M', status: 'Active' },
    { enrollment_id: 'E3', member_id: 'MEM-3', member_number: 'PH-3', program_id: 'DP-300', doi: '2026-06-15', branch: 'BR-1', mas: 'M', status: 'Active' },
  ]);
  const col = (id, enrollment, member, program, month, nop, amount, months = 1) => ({ collection_id: id, collection_batch_id: 'CBT', enrollment_id: enrollment, member_id: member, member_number: member.replace('MEM', 'PH'), program_id: program, or_number: id, or_date: `${month}-05`, amount_collected: amount, month_from: month, month_to: `2026-${String(Number(month.slice(5)) + months - 1).padStart(2, '0')}`, nop_from: nop, nop_to: nop + months - 1, status: 'Posted' });
  await seed('collections', [
    col('C1a', 'E1', 'MEM-1', 'DP-300', '2026-07', 2, 300), col('C1b', 'E1', 'MEM-1', 'DP-300', '2026-08', 3, 600, 2),
    col('C2a', 'E2-150', 'MEM-2', 'DP-150', '2026-06', 2, 150), col('C2b', 'E2', 'MEM-2', 'DP-300', '2026-07', 2, 300),
    col('C3', 'E3', 'MEM-3', 'DP-300', '2026-07', 2, 450),
  ]);
  await seed('program_incentives', [{ incentive_id: '150-MAS', program_id: 'DP-150', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'fixed', mark_up: 0, incentive_amount: 50 }]);
  const route = h.load('app/api/programs/transfer/route.ts');
  const response = await route.POST(request({ from: 'DP-300', to: 'DP-150', all: true, reason: 'Wrong program' }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.deepEqual([result.moved, result.merged, result.left.map((item) => item.enrollmentId)], [2, 1, []], 'P450 is three P150 months, so E3 moves too');
  const rows = await query("select collection_id, enrollment_id, nop_from, nop_to, month_from, month_to, amount_collected::float8 as amount from collections order by collection_id");
  assert.deepEqual(rows.map((row) => [row.collection_id, row.enrollment_id, row.nop_from, row.nop_to, row.month_from, row.month_to, row.amount]), [
    ['C1a', 'E1', 2, 3, '2026-07', '2026-08', 300], ['C1b', 'E1', 4, 7, '2026-09', '2026-12', 600],
    ['C2a', 'E2-150', 2, 2, '2026-06', '2026-06', 150], ['C2b', 'E2-150', 3, 4, '2026-07', '2026-08', 300],
    ['C3', 'E3', 2, 4, '2026-07', '2026-09', 450],
  ], 'amounts kept; months = amount / new pay, numbered on by OR date from the DOI');
  assert.equal((await query("select account_status from member_programs where enrollment_id = 'E1'"))[0].account_status, 'ADV', 'paid through December');
  assert.equal((await query("select remittance_amount::float8 as share from collections where collection_id = 'C1b'"))[0].share, 400, 'incentives of the new program for four months');

  // Into a flexible program: a receipt keeps its months while each gets the minimum, else as many minimums as it holds;
  // a receipt below the minimum leaves its account.
  await seed('program_incentives', [{ incentive_id: 'FLEX-MAS', program_id: 'DP-FLEX', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'fixed', mark_up: 0, incentive_amount: 50 }]);
  const flex = await (await route.POST(request({ from: 'DP-150', to: 'DP-FLEX', all: true, reason: 'Flexible plan' }))).json();
  assert.deepEqual([flex.moved, flex.left.map((item) => item.enrollmentId)], [2, ['E2-150']], JSON.stringify(flex));
  assert.match(flex.left[0].why, /less than the ₱200 minimum/);
  const flexRows = await query("select collection_id, nop_from, nop_to, month_from, month_to from collections where enrollment_id in ('E1','E3') order by collection_id");
  assert.deepEqual(flexRows.map((row) => [row.collection_id, row.nop_from, row.nop_to, row.month_from, row.month_to]), [
    ['C1a', 2, 2, '2026-07', '2026-07'], ['C1b', 3, 5, '2026-08', '2026-10'], ['C3', 2, 3, '2026-07', '2026-08'],
  ]);
});

test('per-MAS report CVE: what each MAS was expected to collect in the period', async () => {
  const h = harness();
  const { duesIn, expectedByMas } = h.load('lib/mas-expected.ts');
  // Monthly dues on the DOI's day from the month after the DOI (the last day of a shorter month).
  assert.deepEqual(duesIn('2026-01-31', '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(duesIn('2026-10-03', '2026-10-01', '2026-10-31'), [], 'the DOI month is the New Sale');
  assert.deepEqual(duesIn('2026-08-05', '2026-10-05', '2026-10-11'), ['2026-10-05'], 'a week holds the dues that fall in it');
  await seed('programs', [{ program_id: 'DP-1', program_name: 'P', base_pay: 300 }]);
  await seed('members', [1, 2, 3].map((n) => ({ member_id: `M${n}`, member_number: `PH-${n}`, surname: 'S', first_name: 'A' })));
  await seed('member_programs', [
    { enrollment_id: 'E1', member_id: 'M1', member_number: 'PH-1', program_id: 'DP-1', doi: '2026-06-10', branch: 'BUHANGIN', mas: 'INTAS, BELLOSA', status: 'Active', account_status: 'U' },
    { enrollment_id: 'E2', member_id: 'M2', member_number: 'PH-2', program_id: 'DP-1', doi: '2026-09-20', branch: 'Buhangin', mas: 'Intas, Bellosa', status: 'Active', account_status: '60D' },
    { enrollment_id: 'E3', member_id: 'M3', member_number: 'PH-3', program_id: 'DP-1', doi: '2026-05-01', branch: 'BUHANGIN', mas: 'INTAS, BELLOSA', status: 'Active', account_status: 'Forfeited' },
  ]);
  const month = await expectedByMas('2026-10-01', '2026-10-31', ['BUHANGIN']);
  assert.deepEqual(month.get('intas, bellosa'), { accounts: 2, gross: 600 }, 'two open accounts due in October; the forfeited one is not expected');
  const year = await expectedByMas('2026-01-01', '2026-12-31', ['BUHANGIN']);
  assert.deepEqual(year.get('intas, bellosa'), { accounts: 2, gross: 300 * (6 + 3) }, 'yearly adds every month due (July–December and October–December)');
});

test('deleting a remittance keeps its entries for adjustments, or deletes them with it for duplicates', async () => {
  const h = harness();
  const { planDeletion, deleteRecord } = h.load('lib/admin-delete.ts');
  const run = (work) => h.load('lib/encoder-context.ts').runAsSystem(work);
  const setUp = async (remittance) => {
    await seed('remittances', [{ remittance_id: remittance, status: 'Pending Approval', mas: 'MAS-2', date_remitted: '2026-10-21' }]);
    await seed('collections', [
      { collection_id: `${remittance}-C1`, collection_batch_id: `${remittance}-B`, enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', or_number: `${remittance} 1 A`, amount_collected: 350, status: 'Posted', linked_remittance_id: remittance, remittance_status: 'Pending Approval' },
      { collection_id: `${remittance}-C2`, collection_batch_id: `${remittance}-B`, enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', or_number: `${remittance} 2 A`, amount_collected: 350, status: 'Posted', remittance_status: 'Pending Approval' },
    ]);
    await seed('remittance_collections', [{ remittance_collection_id: `${remittance}-L2`, remittance_id: remittance, collection_id: `${remittance}-C2` }]);
  };
  await seedAccount();
  await seed('collections', [{ collection_id: 'OTHER', collection_batch_id: 'CBT-O', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', or_number: '9 A', amount_collected: 350, status: 'Posted', remittance_status: 'Outstanding' }]);

  // The remittance only: its entries stay, Outstanding again.
  await setUp('REM-ADJ');
  await run(() => deleteRecord('remittance', 'REM-ADJ', 'adjustments'));
  assert.deepEqual((await query("select collection_id, remittance_status from collections where collection_id like 'REM-ADJ%' order by 1")).map((row) => [row.collection_id, row.remittance_status]), [['REM-ADJ-C1', 'Outstanding'], ['REM-ADJ-C2', 'Outstanding']]);

  // With its entries: the slip, its links and its collections go; the member's other collection stays.
  await setUp('REM-DUP');
  const plan = await planDeletion('remittance', 'REM-DUP', undefined, { withEntries: true });
  assert.deepEqual(plan.blockers, [], 'its own remittance does not block deleting its entries');
  assert.deepEqual(plan.ids.collections.sort(), ['REM-DUP-C1', 'REM-DUP-C2']);
  assert.ok(plan.effects.includes('1 remittance') && plan.effects.includes('2 collections'), plan.effects.join(', '));
  await run(() => deleteRecord('remittance', 'REM-DUP', 'Duplicate entries', { withEntries: true }));
  assert.equal((await query("select count(*)::int as n from remittances where remittance_id = 'REM-DUP'"))[0].n, 0);
  assert.equal((await query("select count(*)::int as n from remittance_collections where remittance_id = 'REM-DUP'"))[0].n, 0);
  assert.equal((await query("select count(*)::int as n from collections where collection_id like 'REM-DUP%'"))[0].n, 0, 'the duplicates leave reports and the OR check');
  assert.equal((await query("select count(*)::int as n from collections where collection_id = 'OTHER'"))[0].n, 1, 'other entries of the member stay');
  const [correction] = await query("select module, reason from record_corrections where record_id = 'REM-DUP'");
  assert.deepEqual([correction.module, correction.reason], ['Delete remittance with its entries', 'Duplicate entries']);
});

test('renumbering starts from the first payment of the account, never from the DOI', () => {
  const h = harness();
  const { renumber, numberingStart } = h.load('lib/entry-edit.ts');
  const paid = [{ id: 'C1', enrollmentId: 'E1', orDate: '2026-01-20', orNumber: '1 A', monthFrom: '2026-02', monthTo: '2026-02', nopFrom: 1, nopTo: 1, amount: 350, dateRemitted: '', mas: '' }];
  // No payment yet: the first collection NOP and the month after DOI.
  assert.deepEqual(numberingStart([], { doi: '2026-01-15', registrationFee: true }), { nop: 1, month: '2026-02' });
  assert.deepEqual(numberingStart([], { doi: '2026-01-15' }), { nop: 2, month: '2026-02' });
  const [withFee] = renumber({ nop: 1, month: '2026-02' }, paid, () => 2);
  assert.deepEqual([withFee.nopFrom, withFee.nopTo, withFee.monthFrom, withFee.monthTo], [1, 2, '2026-02', '2026-03']);
  // An old-system account whose DOI does not line up with its NOPs: NOP 30 paid June 2026 although the DOI is 2024-03.
  // Counted again at half the pay, it keeps starting at NOP 30 in June (the DOI would have put NOP 30 in August 2026).
  const legacy = [{ ...paid[0], id: 'L1', orDate: '2026-06-05', monthFrom: '2026-06', monthTo: '2026-06', nopFrom: 30, nopTo: 30 }, { ...paid[0], id: 'L2', orDate: '2026-07-05', monthFrom: '2026-07', monthTo: '2026-07', nopFrom: 31, nopTo: 31 }];
  const start = numberingStart(legacy.map((payment) => ({ nop: payment.nopFrom, month: payment.monthFrom })), { doi: '2024-03-10' });
  assert.deepEqual(start, { nop: 30, month: '2026-06' });
  assert.deepEqual(renumber(start, legacy, () => 2).map((payment) => [payment.nopFrom, payment.nopTo, payment.monthFrom, payment.monthTo]), [[30, 31, '2026-06', '2026-07'], [32, 33, '2026-08', '2026-09']]);
});

test('day-end Clearing review: earlier lines are kept or cleared, and what was encoded stays recorded (October 21, 2026)', async () => {
  const h = harness();
  const clearing = h.load('lib/clearing.ts');
  const today = h.load('lib/remittance-deadline.ts').manilaNow().date;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'MAS-2']);
  await seed('employees', [{ employee_id: 'DPE-0003', full_name: 'MAS-3' }, { employee_id: 'DPE-0004', full_name: 'MAS-4' }], { skipExisting: true });
  const line = (id, employee, covers, day = yesterday) => ({ clearing_id: id, branch: 'BR-1', employee_id: employee, employee_name: employee, cleared_at: `${day}T02:00:00Z`, cleared_date: day, status: 'Open', covers, encoded_by_employee_id: 'DPE-7' });
  // Yesterday: MAS-2 cleared for both but only New Sales came; MAS-3 cleared for Collections, nothing encoded; MAS-4 kept.
  await seed('clearings', [line('CLR-BOTH', 'DPE-0002', 'Both'), line('CLR-NONE', 'DPE-0003', 'Collections'), line('CLR-KEEP', 'DPE-0004', 'New Sales'), line('CLR-TODAY', 'DPE-0002', 'Both', today),
    { ...line('CLR-OTHER', 'DPE-0003', 'New Sales'), encoded_by_employee_id: 'DPE-9' }]);
  await seed('sales', [{ sale_id: 'SAL-1', member_number: 'PH-1', program_id: 'DP-1', amount_paid: 350, application_no: 'APP-1', branch: 'BR-1', mas: 'MAS-2', accountable_employee_id: 'DPE-0002',
    date_remitted: yesterday, encoded_at: `${yesterday}T03:00:00Z`, remittance_status: 'Pending Remittance Approval' }]);
  const review = await clearing.getDayEndReview('DPE-7');
  assert.deepEqual(review.map((item) => item.id).sort(), ['CLR-BOTH', 'CLR-KEEP', 'CLR-NONE'], 'only the earlier lines of this clerk, not those of today');
  assert.deepEqual(review.find((item) => item.id === 'CLR-BOTH').kinds.map((part) => [part.kind, part.encoded]), [['New Sales', 1], ['Collections', 0]]);
  await assert.rejects(() => clearing.settleDayEnd({ clear: ['CLR-OTHER'] }, { employeeId: 'DPE-7', name: 'Clerk' }), /no longer waiting/, 'a line of another clerk cannot be answered');
  const done = await clearing.settleDayEnd({ keep: ['CLR-KEEP'], clear: ['CLR-BOTH', 'CLR-NONE'] }, { employeeId: 'DPE-7', name: 'Clerk' });
  assert.deepEqual(done, { kept: 1, removed: 1, narrowed: 1 });
  const rows = Object.fromEntries((await query("select clearing_id, status, covers, closed_reason from clearings")).map((row) => [row.clearing_id, row]));
  assert.deepEqual([rows['CLR-BOTH'].status, rows['CLR-BOTH'].covers], ['Encoded', 'New Sales'], 'keeps only the encoded kind and takes no more encoding');
  assert.match(rows['CLR-BOTH'].closed_reason, /^Cleared from the list by Clerk.*Collections not encoded/);
  assert.equal(rows['CLR-NONE'].status, 'Removed', 'nothing encoded: removed');
  assert.equal(rows['CLR-KEEP'].status, 'Open', 'kept as it was');
  assert.equal(await count('sales'), 1, 'the encoded New Sale stays recorded');
  assert.equal(await clearing.clearedAt('DPE-0002', 'BR-1', yesterday, '', 'New Sales'), `${yesterday} 10:00`, 'still the evidence of when that cash was received');
  assert.deepEqual(await clearing.getDayEndReview('DPE-7'), [], 'answered: not asked again today');
  const page = await clearing.getClearingPage('DPE-7');
  assert.deepEqual(page.clearings.map((item) => item.id).sort(), ['CLR-KEEP', 'CLR-TODAY'], 'cleared lines leave the Clearing list');
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
      branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 200,
      encodedBy: 'attacker', userId: 'attacker',
      sales: [{ existingMember, memberNumber: existingMember ? 'PH-1' : '', programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', addressHouse: 'Complete Address', encodedBy: 'attacker', ...(existingMember ? { doiTime: '08:15' } : {}), beneficiaries: existingMember ? [] : [{ surname: 'Santos', firstName: 'Ben', middleName: '', birthdate: '2000-01-02', age: 26, relationship: 'Child' }] }],
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
    // The DOI time (owner, October 19, 2026): as typed, otherwise the time the sale was saved, on the sale and the account.
    const times = [sale.doi_time, (await query('select doi_time from member_programs'))[0].doi_time];
    if (existingMember) assert.deepEqual(times, ['08:15:00', '08:15:00']);
    else { assert.match(times[0], /^\d{2}:\d{2}:00$/); assert.equal(times[1], times[0]); }
    if (!existingMember) {
      const [beneficiary] = await query('select * from beneficiaries');
      assert.match(beneficiary.beneficiary_id, /^BEN-/);
      assert.match(beneficiary.member_id, /^MEM-/);
      assert.match(beneficiary.sale_id, /^SALE-/);
      assert.deepEqual([beneficiary.surname, beneficiary.first_name, beneficiary.middle_name, beneficiary.birthdate?.toISOString().slice(0, 10), beneficiary.age, beneficiary.relationship], ['Santos', 'Ben', null, '2000-01-02', 26, 'Child']);
    }
  });
}

test('New Sales and Collections can be saved after 3:00 PM (Clearing records the time)', async () => {
  const admin = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  for (const route of ['app/api/sales/route.ts', 'app/api/collections/route.ts']) {
    const response = await admin.load(route).POST(request({}));
    // An empty request is refused for its missing fields, never for the time of day.
    assert.notEqual(response.status, 403, route);
    assert.doesNotMatch((await response.json()).message, /closed/i);
  }
});

test('Clearing: no encoding without it, and its time is when the cash was received', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila(), month = today.slice(0, 7);
  const next = rules.monthName(rules.monthIndex(month) + 1);
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active'], ['PMT-GCASH', 'GCash', false, false, 'active']];
  await seedAccount({ doi: month + '-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('program_incentives', [{ incentive_id: 'I1', program_id: 'DP-1', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '1001 C', orDate: today };
  // ₱350 at a ₱50 mark-up and 50% MAS incentive: the MAS keeps ₱150 and remits ₱200. Paid by GCash, so it waits for
  // its receipt photo (cash would go to approval at once).
  const batch = { branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'MAS', paymentMethod: 'GCash', controlTotal: 200, collections: [entry] };
  const route = h.load('app/api/collections/route.ts');
  globalThis.dayongClearingNotRequired = false;
  try {
    const refused = await route.POST(request(batch));
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).message, /not in Clearing for Collections in BR-1/);
    assert.equal(await count('collections'), 0, 'nothing is saved without a clearing');
    // Cleared at 10:15 AM Manila today: the batch saves, and that is when the cash counts as received.
    await seed('clearings', [{ clearing_id: 'CLR-1', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T02:15:00Z`, cleared_date: today, status: 'Open' }]);
    const saved = await route.POST(request(batch));
    assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
    const clearing = h.load('lib/clearing.ts');
    assert.equal(await clearing.clearedAt('DPE-0002', 'BR-1', today, `${today} 23:00`), `${today} 10:15`);
    assert.equal(await clearing.clearedAt('DPE-0002', 'BR-9', today), '', 'another branch has no clearing');
    // Progress: saved without a receipt photo, then remitted (approved). The clearing is set just before the encoding.
    await query("update clearings set cleared_at = now() - interval '1 minute', cleared_date = (now() at time zone 'Asia/Manila')::date where clearing_id = 'CLR-1'");
    const stageOf = async () => (await clearing.withProgress(await clearing.getEncodableClearings())).find((item) => item.id === 'CLR-1');
    // Both ticked: the Collections wait for their receipt, the New Sales are not encoded yet, so the line waits for encoding.
    assert.deepEqual((await stageOf()).kinds.map((part) => [part.kind, part.stage]), [['New Sales', 'Waiting for encoding'], ['Collections', 'Waiting for receipt']], 'each kind has its own stage');
    assert.equal((await stageOf()).stage, 'Waiting for encoding');
    await query("update clearings set covers = 'Collections' where clearing_id = 'CLR-1'");
    assert.deepEqual((await stageOf()).kinds.map((part) => part.kind), ['Collections'], 'a Collections-only clearing tracks only Collections');
    assert.equal((await stageOf()).stage, 'Waiting for receipt', 'saved in My Entries without a receipt photo');
    assert.equal((await stageOf()).entries.total, 1);
    assert.match(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', today, 'New Sales'), /not in Clearing for New Sales in BR-1/, 'New Sales cannot be encoded on a Collections-only clearing');
    assert.equal(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', today, 'Collections'), '');
    await query("update collections set remittance_method = 'Cash'");
    assert.equal((await stageOf()).stage, 'For approval', 'cash skips Waiting for receipt');
    await query("update collections set remittance_method = 'GCash'");
    await query("update collections set remittance_status = 'Remitted'");
    assert.equal((await stageOf()).stage, 'Approved', 'every entry remitted');
    await query("update collections set remittance_status = 'Outstanding'");
    // Once their entries are on a slip, the clearing is Encoded; a removed clearing does not allow encoding.
    assert.equal(await clearing.closeClearings('DPE-0002', 'BR-1', today, 'REM-1'), 1);
    assert.equal((await query("select status, remittance_id from clearings where clearing_id = 'CLR-1'"))[0].status, 'Encoded');
    assert.equal(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', today), '', 'an Encoded clearing still allows a second batch that day');
    await query("update clearings set status = 'Removed' where clearing_id = 'CLR-1'");
    assert.match(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', today), /not in Clearing/);
    // Cleared today for cash remitted yesterday: an Open clearing from a later day covers it; the branch ignores case.
    const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    await seed('clearings', [{ clearing_id: 'CLR-2', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T03:00:00Z`, cleared_date: today, status: 'Open' }]);
    assert.equal(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'br-1 ', yesterday), '', 'an Open clearing today covers yesterday');
    assert.equal(await clearing.clearedEmployee(['DPE-0009', 'DPE-0002'], 'BR-1', today), 'DPE-0002', 'the cleared one of two people with the same name');
    assert.match(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-9', today), /cleared for BR-1 on/, 'the message says where they are cleared');
    assert.equal((await clearing.getEncodableClearings()).map((item) => item.id).includes('CLR-2'), true, 'listed for the batch picker');
    // A Date Remitted moved off the clearing day needs the reason it was changed; the clearing day itself does not.
    assert.match(await clearing.dateRemittedReasonProblem('DPE-0002', 'BR-1', yesterday, '', 'Collections'), /Enter the reason the Date Remitted was changed/);
    assert.equal(await clearing.dateRemittedReasonProblem('DPE-0002', 'BR-1', yesterday, 'Meeting all day', 'Collections'), '');
    assert.equal(await clearing.dateRemittedReasonProblem('DPE-0002', 'br-1', today, '', 'Collections'), '', 'the clearing day needs no reason');
    const moved = await route.POST(request({ ...batch, dateRemitted: yesterday }));
    assert.equal(moved.status, 400);
    assert.match((await moved.json()).message, /not the day they were cleared/, 'the save asks why the Date Remitted was changed');
  } finally { globalThis.dayongClearingNotRequired = true; }
});

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
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '1001 B', orDate: today };
  const batch = { branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'DTO', paymentMethod: 'GCash', paymentReference: 'GC-778899', controlTotal: 580, collections: [entry, { ...entry, monthFrom: afterNext, monthTo: afterNext, nopFrom: 3, nopTo: 3, orNumber: '1002 B' }] };
  const route = h.load('app/api/collections/route.ts');
  // The reference number is optional since October 8, 2026 (the receipt photo is the proof): a GCash batch without one is
  // not refused for it, and fails only on the next check (the turnover total).
  assert.doesNotMatch((await (await route.POST(request({ ...batch, paymentReference: '' }))).json()).message, /reference number/);
  assert.match((await (await route.POST(request({ ...batch, autoApproveRemittance: true, cashReceived: 400 }))).json()).message, /verified in Remittances/);
  // A remittance penalty needs a note saying what it is for.
  assert.match((await (await route.POST(request({ ...batch, penalty: 50, penaltyNote: '' }))).json()).message, /what the penalty is for/);
  assert.match((await (await route.POST(request({ ...batch, penalty: -5, penaltyNote: 'x' }))).json()).message, /zero or a positive/);
  // Fidelity is the employee's own money: no limit and any batch (covered by the Fidelity tests below).
  // Direct to Office earns no incentive: the turnover total is the whole gross, 2 × ₱350 (owner, October 10, 2026).
  assert.match((await (await route.POST(request(batch))).json()).message, /700/, 'a DTO batch expects the gross as its total');
  assert.equal((await query('select count(*)::int as n from collections'))[0].n, 0, 'rejected batches save nothing');
  const response = await route.POST(request({ ...batch, collectedBy: 'Collector', originalMasOfficerName: 'ignored', penalty: 50, penaltyNote: 'Late turnover' }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  const written = await query('select * from collections order by or_number');
  assert.equal(written.length, 2);
  // The database links each collection to its branch and MAS records from their names (migration 0011).
  assert.deepEqual(written.map((row) => [row.branch_id, row.mas_employee_id]), [['BR-1', 'DPE-0002'], ['BR-1', 'DPE-0002']]);
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
  assert.equal((await route.POST(request({ ...batch, collections: [{ ...entry, orNumber: '1003 B' }], controlTotal: 200 }))).status, 400);
  // An OR number must end with its branch letter (lib/or-number.ts).
  const bare = await route.POST(request({ ...batch, collections: [{ ...entry, orNumber: '1004' }], controlTotal: 200 }));
  assert.equal(bare.status, 400);
  assert.match((await bare.json()).message, /needs the branch letter/);
  assert.equal(result.remittanceId, undefined);
  assert.equal(result.grossCollection, 700);
  assert.match(result.message, /₱50.00 penalty/);
});

test('the next OR number of a Collections batch is the last one plus one, letter kept', () => {
  const { nextOrNumber } = harness().load('lib/or-number.ts');
  assert.equal(nextOrNumber('17671 N'), '17672 N');
  assert.equal(nextOrNumber('13584c'), '13585C', 'the letter in capitals');
  assert.equal(nextOrNumber('0099C'), '0100C', 'leading zeros kept');
  assert.equal(nextOrNumber('999 B'), '1000 B');
  assert.equal(nextOrNumber('1004'), '', 'no letter: nothing guessed');
  assert.equal(nextOrNumber(''), '');
});

test('the next application number of a New Sales batch is the last one plus one, series kept', () => {
  const { nextApplicationNumber } = harness().load('lib/entry-controls.ts');
  assert.equal(nextApplicationNumber('062026-01616'), '062026-01617');
  assert.equal(nextApplicationNumber('2026SP-0790'), '2026SP-0791');
  assert.equal(nextApplicationNumber('2026sp-0999'), '2026sp-1000', 'the series as written');
  assert.equal(nextApplicationNumber('2026T-00405 '), '2026T-00406');
  assert.equal(nextApplicationNumber('016'), '', 'no dash: nothing guessed');
  assert.equal(nextApplicationNumber('2026SP-'), '');
  assert.equal(nextApplicationNumber(''), '');
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

test('a remittance save skips old remitted rows but still updates the right row', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  // Imported old data: remitted, no encoder, no slip. The ledger does not read these rows.
  const old = (id) => { const row = Array(33).fill(''); row[0] = id; row[6] = 'BR-1'; row[8] = `OR-${id}`; row[9] = '2026-01-05'; row[10] = 350; row[19] = 'Posted'; row[26] = 200; row[28] = 'Remitted'; return row; };
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[26] = 200; collection[28] = 'Outstanding'; collection[30] = 'DPE-0002'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, old('COL-OLD-1'), old('COL-OLD-2'), collection];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  deadlineHeaders(h);
  const response = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-1'], actualAmount: 200, remittanceDate: '2026-09-26', remittanceTime: '09:00', receivedByName: 'Cashier' }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const status = h.writes[0].requestBody.requests[2].updateCells;
  // Sheet row 4 (0-based index 3): the header, the two old rows, then COL-1.
  assert.equal(status.range.startRowIndex, 3);
  assert.deepEqual(status.rows[0].values.map((value) => value.userEnteredValue.stringValue)[0], 'Pending Remittance Approval');
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
  // Paid by e-wallet: only cash (counted at Clearing) is approved without a receipt photo.
  const collection = Array(34).fill(''); collection[0] = 'COL-1'; collection[10] = 350; collection[19] = 'Posted'; collection[28] = 'Pending Remittance Approval'; collection[29] = 'REM-1'; collection[33] = 'GCash';
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
  const response = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 400, sales: [sale('DP-1', 'APP-1'), sale('DP-2', 'APP-2')] }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(await count('members'), 1, 'one member record');
  assert.equal(await count('member_programs'), 2, 'two program enrollments');
  assert.equal(result.savedSales[0].memberNumber, result.savedSales[1].memberNumber);
  // Saved for real: the same person as a new member again is caught as a returning member.
  const again = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 200, sales: [sale('DP-1', 'APP-3')] }));
  assert.match((await again.json()).message, /Ben Reyes with this birthdate is already member/);
  const other = (applicationNo) => ({ ...sale('DP-1', applicationNo), surname: 'Lim' });
  const repeat = await route.POST(request({ branch: 'BR-1', mas: 'mas', dateRemitted: '2026-09-25', controlTotal: 400, sales: [other('APP-3'), other('APP-4')] }));
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

test('Finance-Auditor sees every ticked page in the Finance layout; other custom roles are grouped like the administrator sidebar', () => {
  const { visibleNavigation } = harness().load('lib/navigation.ts');
  const permissions = { manageUsers: false, manageAttendance: false, viewAttendanceReports: false };
  const ticked = ['/', '/audit', '/remittances', '/payroll', '/fidelity', '/history', '/attendance-tracking', '/exceptions', '/todays-entries', '/members', '/expenses'];
  const sections = visibleNavigation('Finance-Auditor', { roleNames: ['Finance-Auditor'], permissions, rolePages: { 'finance-auditor': ticked } });
  const shown = new Set(sections.flatMap((section) => section.items.map((item) => item.href)));
  for (const href of ticked) assert.equal(shown.has(href), true, href);
  assert.equal(sections.some((section) => section.title === 'My Portfolio'), false, 'not the MAS layout');
  assert.equal(sections[0].title, 'Overview');
  const custom = visibleNavigation('Auditor', { roleNames: ['Auditor'], permissions, rolePages: { auditor: ['/audit', '/history', '/expenses'] } });
  assert.deepEqual(custom.flatMap((section) => section.items.map((item) => item.href)).sort(), ['/', '/audit', '/expenses', '/history']);
  assert.equal(custom.some((section) => section.title === 'My Portfolio'), false);
});

test('pages granted to a role appear in the section where they belong, not under More', () => {
  const { visibleNavigation } = harness().load('lib/navigation.ts');
  const permissions = { manageUsers: false, manageAttendance: false, viewAttendanceReports: false };
  const titles = (sections) => Object.fromEntries(sections.map((section) => [section.title, section.items.map((item) => item.href)]));
  // CEO / President list Company Reports and the Statement of Account under Reports by default.
  assert.deepEqual(titles(visibleNavigation('CEO', { roleNames: ['CEO'], permissions })).Reports, ['/company-reports', '/admin-reports', '/mam', '/soa']);
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
  const body = (fidelityAmount) => ({ branch: 'BR-1', mas: 'Maria', dateRemitted: '2026-09-25', fidelityAmount, controlTotal: 200 + (Number(fidelityAmount) || 0), sales: [{ existingMember: false, memberNumber: '', programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-9', addressHouse: 'Address', beneficiaries: [] }] });
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

test('a program enrollment transfers to an active employee of any branch, keeping or moving its branch, with a reason and history', async () => {
  const h = harness({ userId: 'USR-2', employeeId: 'MD-1', name: 'HR Person', roleNames: ['HR Officer'], permissions: {} });
  await seedAccount({ doi: '2026-01-15', branch: 'MATINA', mas: 'Old MAS' });
  await seed('employees', [{ employee_id: 'MD-6', full_name: 'New MAS' }]);
  h.rows.Employees = [[], ['MD-5', 'Old MAS', 'MATINA', 'MAS', 'active'], ['MD-6', 'New MAS', 'MATINA', 'MAS', 'active'], ['MD-7', 'Toril MAS', 'TORIL', 'MAS', 'active'], ['MD-8', 'Toril Two', 'TORIL', 'MAS', 'active'], ['MD-9', 'Gone MAS', 'MATINA', 'MAS', 'resigned']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-5', 'BR-1'], ['EBA-2', 'MD-6', 'BR-1'], ['EBA-3', 'MD-7', 'BR-2'], ['EBA-4', 'MD-8', 'BR-2'], ['EBA-5', 'MD-9', 'BR-1']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO', '', '', '', '', '', '', '', '', '', 'active'], ['BR-2', 'TORIL', 'METRO', '', '', '', '', '', '', '', '', '', 'active']];
  const route = h.load('app/api/members/transfer/route.ts');
  const listed = await (await route.GET(new Request('http://localhost/api/members/transfer?enrollmentId=ENR-1'))).json();
  assert.deepEqual(listed.candidates.map((item) => [item.name, item.branches]), [['New MAS', ['MATINA']], ['Toril MAS', ['TORIL']], ['Toril Two', ['TORIL']]], 'any branch, active, not the current MAS');
  assert.match((await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: '' }))).json()).message, /reason/);
  const done = await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: 'Old MAS resigned' }))).json();
  assert.deepEqual([done.transfer.fromMas, done.transfer.toMas, done.transfer.assigned, done.transfer.movedBranch], ['Old MAS', 'New MAS', [], 0], 'same branch: only the MAS changes');
  assert.equal((await query("select mas from member_programs where enrollment_id = 'ENR-1'"))[0].mas, 'New MAS', 'the enrollment MAS changes');
  const [history] = await query('select enrollment_id, member_id, member_number, program_id, branch, from_mas, to_mas, to_employee_id, reason, encoded_by_name from member_transfers');
  assert.deepEqual(Object.values(history), ['ENR-1', 'MEM-1', 'PH-1', 'DP-1', 'MATINA', 'Old MAS', 'New MAS', 'MD-6', 'Old MAS resigned', 'HR Person']);
  assert.deepEqual(await query('select table_name, record_id, employee_id from audit_log'), [{ table_name: 'member_programs', record_id: 'ENR-1', employee_id: 'MD-1' }], 'the MAS change is audited');

  // Another branch's MAS: the choice is required.
  assert.match((await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-7', reason: 'Covering' }))).json()).message, /not assigned to MATINA/);
  assert.match((await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-7', reason: 'Covering', branchMode: 'move', moveTo: 'MATINA' }))).json()).message, /Toril MAS's branches/);
  // Keep: the account stays in MATINA and Toril MAS is assigned to MATINA, so Clearing and Collections accept them.
  const kept = await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-7', reason: 'Covering', branchMode: 'keep' }))).json();
  assert.equal(kept.success, true, JSON.stringify(kept));
  assert.deepEqual(kept.transfer.assigned, ['MATINA']);
  assert.deepEqual(await query("select mas, branch, mas_employee_id from member_programs where enrollment_id = 'ENR-1'"), [{ mas: 'Toril MAS', branch: 'MATINA', mas_employee_id: 'MD-7' }]);
  assert.deepEqual(await query("select branch_id from employee_branches where employee_id = 'MD-7' order by branch_id"), [{ branch_id: 'BR-1' }, { branch_id: 'BR-2' }]);
  // Move: the account goes to Toril Two's branch; the history notes the branch change.
  const moved = await (await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-8', reason: 'Member moved to Toril', branchMode: 'move', moveTo: 'toril' }))).json();
  assert.equal(moved.success, true, JSON.stringify(moved));
  assert.deepEqual([moved.transfer.movedBranch, moved.transfer.moveTo, moved.transfer.assigned], [1, 'TORIL', []]);
  assert.deepEqual(await query("select mas, branch, branch_id, mas_employee_id from member_programs where enrollment_id = 'ENR-1'"), [{ mas: 'Toril Two', branch: 'TORIL', branch_id: 'BR-2', mas_employee_id: 'MD-8' }]);
  assert.equal((await query("select reason from member_transfers where to_employee_id = 'MD-8'"))[0].reason, 'Member moved to Toril (branch MATINA → TORIL)');
  assert.deepEqual(await query("select employee_id from employee_branches where employee_id = 'MD-8' and branch_id = 'BR-1'"), [], 'a move assigns nobody');

  h.setUser({ userId: 'USR-3', employeeId: 'MD-3', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.POST(request({ enrollmentId: 'ENR-1', toEmployeeId: 'MD-6', reason: 'x y z' }))).status, 403, 'only Administrators and HR Officers');
});

test('transfer members of an employee to a MAS from another branch moves every chosen account, keeping or moving branches', async () => {
  const h = harness({ userId: 'USR-1', employeeId: 'MD-0', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  await seedAccount({ enrollment: 'ENR-1', member: 'MEM-1', memberNumber: 'PH-1', doi: '2026-01-15', branch: 'MATINA', mas: 'Old MAS' });
  await seed('members', [{ member_id: 'MEM-2', member_number: 'PH-2', surname: 'Cruz', first_name: 'Ben' }, { member_id: 'MEM-3', member_number: 'PH-3', surname: 'Reyes', first_name: 'Cy' }]);
  await seed('member_programs', [
    { enrollment_id: 'ENR-2', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-1', branch: 'AGDAO', mas: 'Old MAS', status: 'Active' },
    { enrollment_id: 'ENR-3', member_id: 'MEM-3', member_number: 'PH-3', program_id: 'DP-1', branch: 'TORIL', mas: 'Old MAS', status: 'Active' },
  ]);
  h.rows.Employees = [[], ['MD-5', 'Old MAS', 'MATINA', 'MAS', 'active'], ['MD-7', 'Toril MAS', 'TORIL', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'MD-5', 'BR-1'], ['EBA-2', 'MD-5', 'BR-3'], ['EBA-3', 'MD-5', 'BR-2'], ['EBA-4', 'MD-7', 'BR-2']];
  h.rows.Branches = [[], ['BR-1', 'MATINA', 'METRO', '', '', '', '', '', '', '', '', '', 'active'], ['BR-2', 'TORIL', 'METRO', '', '', '', '', '', '', '', '', '', 'active'], ['BR-3', 'AGDAO', 'METRO', '', '', '', '', '', '', '', '', '', 'active']];
  const route = h.load('app/api/members/transfer/route.ts');
  const body = { fromEmployeeId: 'MD-5', enrollmentIds: ['ENR-1', 'ENR-2', 'ENR-3'], toEmployeeId: 'MD-7', reason: 'Old MAS resigned' };
  assert.match((await (await route.POST(request(body))).json()).message, /not assigned to MATINA, AGDAO|not assigned to AGDAO, MATINA/, 'the choice is required');
  const result = await (await route.POST(request({ ...body, branchMode: 'move', moveTo: 'TORIL' }))).json();
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual([result.result.moved, result.result.movedBranch, result.result.moveTo], [3, 2, 'TORIL'], 'nothing is skipped; the two outside TORIL change branch');
  assert.deepEqual(await query('select enrollment_id, mas, branch from member_programs order by enrollment_id'), [
    { enrollment_id: 'ENR-1', mas: 'Toril MAS', branch: 'TORIL' }, { enrollment_id: 'ENR-2', mas: 'Toril MAS', branch: 'TORIL' }, { enrollment_id: 'ENR-3', mas: 'Toril MAS', branch: 'TORIL' }]);
  assert.equal((await query('select count(*)::int as n from member_transfers'))[0].n, 3);
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
  assert.match((await post({ doiTime: '25:00' })).body.message, /DOI time as hours and minutes/, 'a DOI time that is not a time is refused');
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

test('incentives are kept until 3:00 PM the day after the OR date, then the full amount is remitted', async () => {
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
  const kept = await post(onTime, '15:00', 270);
  assert.equal(kept.status, 201, JSON.stringify(kept.body));
  assert.equal(kept.body.remittance.expectedAmount, 270, '15:00 exactly is still within the deadline');
  assert.equal(kept.body.remittance.forfeitedCount, 0);
  const keptRow = onTime.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(keptRow[26], '15:00', 'the time received is stored on the slip');

  const late = setup();
  const forfeited = await post(late, '15:01', 350);
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
  const post = async (h, amountPaid, controlTotal = 200) => {
    const sale = { existingMember: false, programId: 'DP-1', amountPaid, applicationNo: 'APP-1', addressHouse: 'Complete Address', beneficiaries: [] };
    const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal, sales: [sale] }));
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
  const different = await post(editable, '700', 550);
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
  assert.match((await post({ controlTotal: 3500 })).body.message, /total remittance is ₱200\.00 but the turnover sheet says ₱3,500\.00 \(short by ₱3,300\.00\)/);
  assert.match((await post({ controlTotal: 350 })).body.message, /total remittance is ₱200\.00 .* says ₱350\.00/, 'the amount collected is not the control total');
  assert.match((await post({})).body.message, /Enter the net total/);
  // Only the year and series letters: the form number is missing, so the sale is refused before anything else.
  assert.match((await post({ controlTotal: 200, sale: { applicationNo: '2026SP-' } })).body.message, /whole Application Number/);
  assert.match((await post({ controlTotal: 200, sale: { applicationNo: '2026 SP' } })).body.message, /whole Application Number/);
  const late = await post({ controlTotal: 350, sale: { orDate: '2026-01-05' } });
  assert.match(late.body.message, /more than one working day old/);
  assert.equal(await count('sales'), 0, 'nothing is saved');
  const explained = await post({ controlTotal: 200, sale: { orDate: '2026-01-05', backdateReason: 'MAS turned in the form late' } });
  assert.equal(explained.status, 200, JSON.stringify(explained.body));
  assert.equal((await query('select backdate_reason from sales'))[0].backdate_reason, 'MAS turned in the form late', 'the reason is kept with the sale');
});

test('No incentive on one New Sale: the MAS earns nothing on it, it is remitted whole, and a reason is required (October 20, 2026)', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const post = async (body) => {
    const sale = { existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', addressHouse: 'Complete Address', beneficiaries: [], noIncentive: true, ...body.sale };
    const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: body.controlTotal, sales: [sale] }));
    return { status: response.status, body: await response.json() };
  };
  assert.match((await post({ controlTotal: 350, sale: { noIncentiveReason: ' ' } })).body.message, /reason it earns no incentive/);
  // With no incentive the whole 350 is remitted, not 200.
  assert.match((await post({ controlTotal: 200, sale: { noIncentiveReason: 'Walk-in member' } })).body.message, /total remittance is ₱350\.00/);
  const saved = await post({ controlTotal: 350, sale: { noIncentiveReason: 'Walk-in member' } });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const [row] = await query('select mas_incentive::float8 as incentive, remittance_amount::float8 as share, forfeited_incentive::float8 as forfeited, no_incentive_reason from sales');
  assert.deepEqual(row, { incentive: 0, share: 350, forfeited: 150, no_incentive_reason: 'Walk-in member' });
});

test('No incentive on one collection of a batch: only that one is remitted whole, and a rejected slip keeps it so (October 20, 2026)', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila(), month = today.slice(0, 7);
  const next = rules.monthName(rules.monthIndex(month) + 1), afterNext = rules.monthName(rules.monthIndex(month) + 2);
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
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '1001 B', orDate: today, noIncentive: true, noIncentiveReason: '' };
  const tiers = [{ role: 'MAS', fromMonth: 1, toMonth: 999, incentiveType: 'percentage', markUp: 50, incentiveAmount: 50 }];
  const share = h.load('lib/remittance.ts').calculateRemittance(350, tiers, 'MAS', 3, 3, 350).remittance;
  const batch = { branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'MAS', paymentMethod: 'GCash', controlTotal: 350 + share,
    collections: [entry, { ...entry, monthFrom: afterNext, monthTo: afterNext, nopFrom: 3, nopTo: 3, orNumber: '1002 B', noIncentive: false }] };
  const route = h.load('app/api/collections/route.ts');
  assert.match((await (await route.POST(request(batch))).json()).message, /reason it earns no incentive/);
  const response = await route.POST(request({ ...batch, collections: [{ ...entry, noIncentiveReason: 'Paid at the office' }, batch.collections[1]] }));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const written = await query('select or_number, remittance_amount::float8 as share, forfeited_incentive::float8 as forfeited, no_incentive_reason from collections order by or_number');
  assert.deepEqual(written, [
    { or_number: '1001 B', share: 350, forfeited: 350 - share, no_incentive_reason: 'Paid at the office' },
    { or_number: '1002 B', share, forfeited: null, no_incentive_reason: null },
  ]);

  // Its slip is rejected: the marked collection keeps no incentive (a late-cash forfeit would be given back).
  const admin = harness({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const id = (await query("select collection_id from collections where or_number = '1001 B'"))[0].collection_id;
  const collectionsHeader = Array(39).fill(''); collectionsHeader[28] = 'Remittance Status';
  const pending = Array(39).fill(''); Object.assign(pending, { 0: id, 6: 'BR-1', 8: '1001 B', 9: today, 10: 350, 19: 'Posted', 26: 350, 28: 'Pending Remittance Approval', 29: 'REM-7', 38: 350 - share });
  const remittancesHeader = Array(27).fill(''); remittancesHeader[12] = 'Difference';
  const slip = Array(27).fill(''); slip[0] = 'REM-7'; slip[4] = 'Pending Approval'; slip[6] = 'USR-1'; slip[10] = 350; slip[11] = 350; slip[25] = 'Collections'; slip[26] = '08:00';
  admin.rows.Collections = [collectionsHeader, pending]; admin.rows.Sales = [Array(44).fill('')]; admin.rows.Remittances = [remittancesHeader, slip];
  admin.rows['Remittance Collections'] = [['Remittance Collection ID'], ['RCL-7', 'REM-7', id, 350]];
  deadlineHeaders(admin);
  // The harness copies these sheet rows into the database; the reason saved above goes back on the copy.
  await admin.sync();
  await query("update collections set no_incentive_reason = 'Paid at the office' where collection_id = $1", [id]);
  const rejected = await admin.load('app/api/remittances/route.ts').PATCH(request({ remittanceId: 'REM-7', decision: 'reject', reason: 'Recount needed' }));
  assert.equal(rejected.status, 200, JSON.stringify(await rejected.clone().json()));
  const amounts = admin.writes.at(-1).requestBody.requests.filter((item) => item.updateCells && [26, 38].includes(item.updateCells.range.startColumnIndex));
  assert.deepEqual(amounts, [], 'no incentive is given back');
});

test('a MAS submits New Sales; only a clerk of that branch reviews them, saves once, or returns them', async () => {
  const users = {
    mas: { userId: 'USR-M', employeeId: 'DPE-0002', name: 'different-mas', roleNames: ['MAS'], permissions: {} },
    clerk: { userId: 'USR-1', employeeId: 'DPE-0001', name: 'clerk', roleNames: ['Entry Clerk'], permissions: {} },
    otherClerk: { userId: 'USR-3', employeeId: 'DPE-0003', name: 'other clerk', roleNames: ['Entry Clerk'], permissions: {} },
  };
  const as = (user) => {
    const h = harness(user);
    h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active'], ['BR-2', 'BR-2', '', '', '', '', '', '', '', '', '', '', 'active']];
    h.rows.Employees = [[], ['DPE-0001', 'clerk', 'BR-1', 'Entry Clerk', 'active'], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active'], ['DPE-0003', 'other clerk', 'BR-2', 'Entry Clerk', 'active']];
    h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0001', 'BR-1'], ['EBA-2', 'DPE-0002', 'BR-1'], ['EBA-3', 'DPE-0003', 'BR-2']];
    h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0]];
    h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
    return h;
  };
  const mas = as(users.mas), clerk = as(users.clerk), otherClerk = as(users.otherClerk);
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const call = async (h, method, url, body) => {
    const route = h.load('app/api/sale-submissions/route.ts');
    const response = await route[method](new Request(`http://localhost${url}`, method === 'GET' ? {} : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }));
    return { status: response.status, body: await response.json() };
  };
  const card = (surname) => ({ id: `S-${surname}`, member: { name: { firstName: 'Ana', surname } }, program: { programCode: 'CODE', amountPaid: '350', dateEnrolled: '2020-01-01' } });

  // An Entry Clerk cannot use the MAS page.
  assert.equal((await call(clerk, 'POST', '/api/sale-submissions', { sales: [card('Cruz')] })).status, 403);
  const submitted = await call(mas, 'POST', '/api/sale-submissions', { sales: [card('Cruz')] });
  assert.equal(submitted.status, 201, JSON.stringify(submitted.body));
  const [row] = await query('select * from sale_submissions');
  assert.equal(row.branch, 'BR-1', 'the branch is the MAS\'s own');
  assert.equal(row.mas, 'different-mas', 'the MAS is the one signed in');
  assert.equal(row.sales[0].program.dateEnrolled, mas.load('lib/remittance-deadline.ts').manilaNow().date, 'Date Enrolled is the day submitted');
  const mine = await call(mas, 'GET', '/api/sale-submissions');
  assert.deepEqual(mine.body.profile.branches.map((branch) => branch.id), ['BR-1']);
  assert.equal(mine.body.submissions[0].status, 'Submitted');

  // Only the clerk assigned to BR-1 sees and saves it.
  assert.equal((await call(otherClerk, 'GET', '/api/sale-submissions?view=review')).body.submissions.length, 0);
  assert.equal((await call(clerk, 'GET', '/api/sale-submissions?view=review')).body.submissions.length, 1);
  const save = async (h, applicationNo) => {
    const sale = { existingMember: false, surname: 'Cruz', firstName: 'Ana', programId: 'DP-1', amountPaid: '350', applicationNo, addressHouse: 'Complete Address', beneficiaries: [] };
    const response = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 200, submissionId: row.submission_id, sales: [sale] }));
    return { status: response.status, body: await response.json() };
  };
  assert.match((await save(otherClerk, 'APP-1')).body.message, /not assigned/);
  const saved = await save(clerk, 'APP-1');
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  const [after] = await query('select status, sale_ids, reviewed_by_name from sale_submissions');
  assert.deepEqual([after.status, after.sale_ids, after.reviewed_by_name], ['Saved', saved.body.savedSales[0].saleId, 'clerk']);
  assert.match((await save(clerk, 'APP-2')).body.message, /already saved/);
  assert.equal(await count('sales'), 1, 'a submission is saved once');
  assert.equal((await call(mas, 'POST', '/api/sale-submissions', { submissionId: row.submission_id, sales: [card('Cruz')] })).status, 400, 'a saved submission cannot be edited');

  // Returned: the MAS sees why, fixes it, and submits it again.
  const second = await call(mas, 'POST', '/api/sale-submissions', { sales: [card('Reyes')] });
  assert.equal((await call(otherClerk, 'PATCH', '/api/sale-submissions', { id: second.body.id, reason: 'Wrong address' })).status, 400);
  assert.equal((await call(clerk, 'PATCH', '/api/sale-submissions', { id: second.body.id, reason: 'Wrong address' })).status, 200);
  const returned = (await call(mas, 'GET', '/api/sale-submissions')).body.submissions.find((item) => item.id === second.body.id);
  assert.deepEqual([returned.status, returned.returnReason], ['Returned', 'Wrong address']);
  assert.equal((await call(clerk, 'GET', '/api/sale-submissions?view=review')).body.submissions.length, 0, 'a returned submission leaves the clerk\'s list');
  assert.equal((await call(mas, 'POST', '/api/sale-submissions', { submissionId: second.body.id, sales: [card('Reyes')] })).status, 201);
  assert.equal((await call(clerk, 'GET', '/api/sale-submissions?view=review')).body.submissions.length, 1, 'submitted again');
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
  await h.sync();
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
  h.rows.Collections[2][35] = 50; // a ₱50 penalty on COL-2, collected with the batch
  const sale = Array(44).fill(''); Object.assign(sale, { 0: 'SAL-1', 1: '2026-06-15T03:00:00.000Z', 2: 'AGDAO', 3: 'Maria', 21: 'DP-1', 26: 500, 30: '2026-06-15', 32: 'DPE-7', 33: 'Clerk', 34: '2026-06-15T03:00:00.000Z', 35: 'Outstanding', 41: 450 });
  h.rows.Sales = [[], sale];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program']];
  const expense = Array(21).fill(''); Object.assign(expense, { 0: 'EXP-1', 1: '2026-06-16', 2: 'Fare', 4: 100, 11: 'Posted', 18: 'DPE-7' });
  h.rows.Expenses = [[], expense];
  await h.sync();
  const { buildClerkReport, weekOfMonth } = h.load('lib/clerk-report.ts');
  // Week N is the week of the month's Nth Monday; days before the first Monday are week 1.
  assert.deepEqual(['2026-10-01', '2026-10-04', '2026-10-05', '2026-10-12', '2026-09-30', '2026-06-01', '2026-06-15'].map(weekOfMonth), [1, 1, 1, 2, 4, 1, 3]);
  const report = await buildClerkReport('weekly', '2026-06-17', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(report.reportName, 'WEEKLY REPORT');
  assert.equal(report.dateLine, 'WEEK 3 JUNE 15-21, 2026');
  assert.equal(report.summaryLabel, '3RD WEEKLY REPORT');
  assert.deepEqual(report.collection.rows.map((row) => [row.label, row.accounts, row.gross, row.incentives, row.net, row.fidelity, row.penalty]), [['6/15/2026', 1, 350, 50, 300, 20, 0], ['6/16/2026', 1, 700, 100, 600, 0, 50]], 'by date; the other clerk\'s COL-3 is not counted');
  assert.deepEqual([report.newSales.total.accounts, report.newSales.total.gross, report.newSales.total.incentives], [1, 500, 50]);
  assert.deepEqual(report.cash, { cashBeg: 0, cashBegEdit: null, salesNet: 450, collectionNet: 900, fidelity: 20, penalty: 50, pendingCash: 0, totalCashIn: 1420, expenses: 100, forwardedToBank: 0, totalCashOut: 100, remainingCashOnHand: 1320, totals: 1420 }, 'the penalty is cash in');
  assert.deepEqual(report.masSummary.rows.map((row) => [row.name, row.sales.accounts, row.collections.accounts, row.collections.gross]), [['Maria', 1, 2, 1050]]);
  // Cash Beg is typed case by case (owner, October 13, 2026): the next week does not carry what was left.
  const next = await buildClerkReport('weekly', '2026-06-24', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(next.cash.cashBeg, 0, 'nothing is carried from the week before');
  assert.equal(next.cash.remainingCashOnHand, 0);
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
  // The file goes to storage; the database row records which entries it covers and where the file is.
  const [row] = await query('select entry_ids, storage_path, photo_data_1 from receipt_photos');
  assert.equal(row.entry_ids, 'COL-1,COL-2');
  assert.equal(row.photo_data_1, null, 'no image data in the database');
  assert.ok(globalThis.dayongTestStorage.has(row.storage_path));
  const viewed = await h.load('lib/receipt-photos.ts').getReceiptPhoto(saved.photoId);
  assert.equal(viewed.dataUrl, `data:image/webp;base64,${data}`, 'viewing returns the same image');
});

test('an expense on the report keeps its receipt photos, and only compressed photos are accepted', async () => {
  const h = harness();
  const expense = Array(21).fill(''); Object.assign(expense, { 0: 'EXP-1', 1: '2026-06-16', 2: 'Fare', 4: 100, 11: 'Posted', 18: 'DPE-7', 20: '2026-06-16T02:00:00.000Z' });
  h.rows.Expenses = [[], expense];
  await h.sync();
  const { expensePhotosFrom, saveExpensePhotos, expensePhotoIds, MAX_EXPENSE_PHOTOS } = h.load('lib/receipt-photos.ts');
  assert.deepEqual(expensePhotosFrom(undefined), [], 'none sent: the route then asks for one');
  assert.throws(() => expensePhotosFrom([{ dataUrl: 'data:image/png;base64,AAAA' }]), /WebP or JPEG/);
  const photo = { dataUrl: `data:image/jpeg;base64,${'A'.repeat(4000)}`, width: 600, height: 800 };
  assert.throws(() => expensePhotosFrom(Array(MAX_EXPENSE_PHOTOS + 1).fill(photo)), /at most 10/);
  // The report and the Expenses page both save through createExpense: no photo, no expense.
  const { createExpense } = h.load('lib/finance-data.ts');
  await assert.rejects(() => h.load('lib/encoder-context.ts').runAsSystem(() => createExpense({ date: '2026-06-16', category: 'Transportation', amount: 50, receiptNumber: 'OR-1', description: 'Fare', approvedBy: 'VP Finance', branch: 'AGDAO' })), /Attach a photo of the receipt/);
  await h.load('lib/encoder-context.ts').runAsSystem(() => saveExpensePhotos('EXP-1', expensePhotosFrom([photo, photo])));
  const ids = (await expensePhotoIds()).get('EXP-1');
  assert.equal(ids.length, 2, 'every photo is kept with the expense');
  const report = await h.load('lib/clerk-report.ts').buildClerkReport('daily', '2026-06-16', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.deepEqual(report.expenses.map((item) => item.photoIds), [ids], 'the report lists them for viewing');
});

test('bank deposits count as cash out, pending cash counts only in its own report, and Cash Beg is typed per report', async () => {
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
  assert.equal(nextDay.cash.cashBeg, 0, 'the 200 left the day before is not carried: Cash Beg is typed, case by case');

  // Cash Beg is the cash received, case by case (owner, October 13, 2026): the clerk types it for a report, with its
  // reason; it belongs to that report only, and without one Cash Beg is zero.
  const { saveCashBeg } = h.load('lib/clerk-cash.ts');
  const { runAsSystem } = h.load('lib/encoder-context.ts');
  await assert.rejects(() => runAsSystem(() => saveCashBeg('DPE-7', 'daily', '2026-09-04', { cashBeg: 1000, reason: '' })), /reason for the Cash Beg/);
  await assert.rejects(() => runAsSystem(() => saveCashBeg('DPE-7', 'daily', '2026-09-04', { cashBeg: -5, reason: 'Counted cash' })), /zero or a positive/);
  await runAsSystem(() => saveCashBeg('DPE-7', 'daily', '2026-09-04', { cashBeg: 1000, reason: 'Counted cash on hand' }));
  const saved = h.writes.at(-1);
  assert.match(saved.range, /'Report Notes'!A:N/, 'a new notes row for that day');
  assert.deepEqual(saved.requestBody.values[0].slice(0, 4), ['DPE-7|daily|2026-09-04', 'DPE-7', 'daily', '2026-09-04']);
  assert.deepEqual(saved.requestBody.values[0].slice(10, 12), [1000, 'Counted cash on hand']);
  h.rows['Report Notes'].push(saved.requestBody.values[0]);
  const typed = await buildClerkReport('daily', '2026-09-04', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(typed.cash.cashBeg, 1000);
  assert.equal(typed.cash.cashBegEdit.reason, 'Counted cash on hand');
  assert.equal(typed.cash.remainingCashOnHand, 1000);
  assert.equal(typed.notes.specificRemarks, '', 'the notes of that day are untouched');
  const later = await buildClerkReport('daily', '2026-09-07', { employeeId: 'DPE-7', name: 'Clerk' });
  assert.equal(later.cash.cashBeg, 0, 'a typed Cash Beg does not carry into later reports');
  assert.equal((await buildClerkReport('monthly', '2026-09-04', { employeeId: 'DPE-7', name: 'Clerk' })).cash.cashBegEdit, null, 'nor into another kind of report');
  assert.equal((await buildClerkReport('daily', '2026-09-03', { employeeId: 'DPE-7', name: 'Clerk' })).cash.cashBeg, 0, 'earlier reports are not affected');
  // Blank clears it (zero): only columns K-N of that row are cleared, the notes stay.
  await runAsSystem(() => saveCashBeg('DPE-7', 'daily', '2026-09-04', { cashBeg: '' }));
  const cleared = h.writes.at(-1);
  assert.equal(cleared.range, "'Report Notes'!K3:N3");
  assert.deepEqual(cleared.requestBody.values, [['', '', '', '']]);
  h.rows['Report Notes'][2].splice(10, 4, '', '', '', '');
  assert.equal((await buildClerkReport('daily', '2026-09-04', { employeeId: 'DPE-7', name: 'Clerk' })).cash.cashBeg, 0);
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

test('remittance write guard rejects entries submitted after another request read them as outstanding', async () => {
  const h = harness();
  await seedSaleLinks();
  await seed('members', [{ member_id: 'MEM-RACE', member_number: 'PH-RACE', surname: 'Test', first_name: 'Test' }]);
  await seed('member_programs', [{ enrollment_id: 'ENR-RACE', member_id: 'MEM-RACE', program_id: 'DP-1' }]);
  await seed('sales', [{ sale_id: 'SALE-RACE', program_id: 'DP-1', remittance_status: 'Outstanding' }]);
  await seed('collections', [{ collection_id: 'COL-RACE', collection_batch_id: 'BATCH-RACE', enrollment_id: 'ENR-RACE', member_id: 'MEM-RACE', program_id: 'DP-1', amount_collected: 350, status: 'Posted', remittance_status: 'Outstanding' }]);
  const { inTransaction, schema } = h.load('lib/db.ts');
  const { lockOutstandingRemittanceEntries } = h.load('lib/remittance-workflow.ts');
  const { eq } = require('drizzle-orm');
  for (const [kind, id, table, idColumn] of [
    ['New Sales', 'SALE-RACE', schema.sales, schema.sales.sale_id],
    ['Collections', 'COL-RACE', schema.collections, schema.collections.collection_id],
  ]) {
    // Both requests selected the same Outstanding entry. The first commits its
    // slip/link; the second must recheck the live row before writing another slip.
    await inTransaction(async tx => {
      await lockOutstandingRemittanceEntries(tx, kind, [id]);
      await tx.insert(schema.remittances).values({ remittance_id: `REM-${id}`, status: 'Pending Approval' });
      await tx.update(table).set({ remittance_status: 'Pending Remittance Approval', linked_remittance_id: `REM-${id}` }).where(eq(idColumn, id));
    });
    await assert.rejects(inTransaction(tx => lockOutstandingRemittanceEntries(tx, kind, [id])), /no longer outstanding/);
    assert.equal((await query('select count(*)::int as n from remittances where remittance_id=$1', [`REM-${id}`]))[0].n, 1);
  }
});

test('entries go to Pending Approval on their own once every receipt photo is attached, and clerks see only theirs', async () => {
  const setup = (photos, method = 'GCash') => {
    const h = harness({ userId: 'USR-7', employeeId: 'DPE-7', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
    const collection = (id, encoder) => { const row = Array(41).fill(''); Object.assign(row, { 0: id, 1: 'CBT-1', 6: 'BR-1', 7: 'Maria', 9: '2026-09-25', 10: 350, 19: 'Posted', 22: encoder, 23: encoder === 'DPE-7' ? 'Clerk' : 'Other', 24: '2026-09-25T02:00:00.000Z', 26: 300, 28: 'Outstanding', 30: 'DPE-2', 31: 'Maria', 32: 'MAS', 33: method, 40: '2026-09-25' }); return row; };
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
  await partial.sync();
  assert.deepEqual(await partial.load('lib/remittance-workflow.ts').submitReadyEntries(['COL-A']), []);
  assert.equal(partial.writes.length, 0);
  // Cash needs no receipt photo (counted at Clearing): the batch goes at once.
  const cash = setup([], 'Cash');
  await cash.sync();
  assert.equal((await cash.load('lib/remittance-workflow.ts').submitReadyEntries(['COL-A'])).length, 1);
  const cashRow = cash.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.match(cashRow[22], /as cash counted at Clearing/);
  // With both photos the batch goes as one slip, expecting exactly the company share.
  const ready = setup(['COL-A,COL-B']);
  await ready.sync();
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
  // View entries: the approver sees every entry on the slip; another clerk cannot open it.
  // (The test sheets record writes without applying them, so the slip is put in place here.)
  const slipRow = Array(28).fill(''); Object.assign(slipRow, { 0: 'REM-T', 1: 'BR-1', 2: 'Maria', 4: 'Pending Approval', 10: 600, 11: 600 });
  ready.rows.Remittances = [ready.rows.Remittances[0], slipRow];
  ready.rows['Remittance Collections'] = [ready.rows['Remittance Collections'][0], ['RCL-1', 'REM-T', 'COL-A', 300, ''], ['RCL-2', 'REM-T', 'COL-B', 300, '']];
  const entriesRoute = ready.load('app/api/remittances/entries/route.ts');
  const shown = await (await entriesRoute.GET(new Request('http://localhost/api/remittances/entries?id=REM-T'))).json();
  assert.deepEqual(shown.entries.map((entry) => [entry.id, entry.remittanceAmount, entry.photoId ? 'photo' : 'none']).sort(), [['COL-A', 300, 'photo'], ['COL-B', 300, 'photo']]);
  ready.setUser({ userId: 'USR-8', employeeId: 'DPE-8', name: 'Other', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await entriesRoute.GET(new Request('http://localhost/api/remittances/entries?id=REM-T'))).status, 400);
});

test('a clerk sees, picks and removes only the clearings they made; administrators see all', async () => {
  const h = harness({ userId: 'USR-7', employeeId: 'DPE-7', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  const today = h.load('lib/account-rules.ts').todayInManila();
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }], { skipExisting: true });
  await seed('clearings', [
    { clearing_id: 'CLR-MINE', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T01:00:00Z`, cleared_date: today, status: 'Open', encoded_by_employee_id: 'DPE-7' },
    { clearing_id: 'CLR-THEIRS', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T01:30:00Z`, cleared_date: today, status: 'Open', encoded_by_employee_id: 'DPE-8' },
  ]);
  const ids = (list) => list.map((item) => item.id).filter((id) => id.startsWith('CLR-MINE') || id.startsWith('CLR-THEIRS')).sort();
  const page = await (await h.load('app/api/clearing/route.ts').GET()).json();
  assert.deepEqual(ids(page.clearings), ['CLR-MINE']);
  assert.deepEqual(ids((await (await h.load('app/api/clearing/open/route.ts').GET()).json()).clearings), ['CLR-MINE']);
  const remove = (id) => h.load('app/api/clearing/route.ts').PATCH(new Request('http://localhost/api/clearing', { method: 'PATCH', body: JSON.stringify({ id, reason: 'Listed by mistake' }), headers: { 'Content-Type': 'application/json' } }));
  assert.equal((await remove('CLR-THEIRS')).status, 400, 'not their clearing');
  h.setUser({ userId: 'USR-9', employeeId: 'DPE-9', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  assert.deepEqual(ids((await (await h.load('app/api/clearing/route.ts').GET()).json()).clearings), ['CLR-MINE', 'CLR-THEIRS']);
  await query("delete from clearings where clearing_id in ('CLR-MINE', 'CLR-THEIRS')");
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
  assert.equal((await route.POST(request({ employeeId: 'MD-5', attendanceDate: '2026-10-05', status: 'Holiday' }))).status, 400, 'only Absent, AWOL, Day Off and Not Required');
});

test('the attendance board marks the selected employees together and skips anyone who clocked in', async () => {
  const h = harness({ userId: 'U1', employeeId: 'MD-1', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true, manageAttendance: true } });
  h.rows.Users = [['user_id', 'employee_id', 'full_name', 'password_hash', 'status', 'created_at', 'role_id'], ['USR-5', 'MD-5', 'Ana Cruz', 'x', 'active', '', ''], ['USR-6', 'MD-6', 'Ben Reyes', 'x', 'active', '', ''], ['USR-7', 'MD-7', 'Cora Lim', 'x', 'active', '', '']];
  h.rows.Employees = [[], ['MD-5', 'Ana Cruz', 'MATINA', 'MAS', 'active'], ['MD-6', 'Ben Reyes', 'MATINA', 'MAS', 'active'], ['MD-7', 'Cora Lim', 'MATINA', 'MAS', 'active']];
  h.rows.Attendance = [['attendance_id'], ['ATT-20261005-MD-6', 'MD-6', '2026-10-05', 'MATINA', '08:00', '17:00', '08:05', '17:00', 8, 0, 'Present', 0, 0, '', '', '', '', '']];
  const route = h.load('app/api/attendance-tracking/daily/route.ts');
  const response = await route.POST(request({ attendanceDate: '2026-10-05', employeeIds: ['MD-5', 'MD-6', 'MD-7'], status: 'Not Required', notes: 'Field work' }));
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.marked, 2);
  assert.deepEqual(result.skipped, [{ employeeId: 'MD-6', reason: 'already clocked in' }]);
  const saved = JSON.stringify(h.writes.filter((write) => String(write.range).includes('Attendance')).map((write) => write.requestBody.values));
  assert.ok(saved.includes('MD-5') && saved.includes('MD-7') && saved.includes('Not Required'), 'both are saved as Not Required');
  assert.ok(saved.includes('No attendance needed marked by Admin') && saved.includes('Field work'), 'who marked it and the note are kept');
  assert.equal((await route.POST(request({ attendanceDate: '2026-10-05', employeeIds: ['MD-5'], status: 'Present' }))).status, 400, 'only the review statuses');
  assert.equal((await route.POST(request({ attendanceDate: '2026-10-04', employeeIds: ['MD-5'], status: 'Absent' }))).status, 400, 'not on a Sunday');
});

test('a mark is reverted with a reason: today back to no record, an earlier day Absent by system', async () => {
  const h = harness({ userId: 'U1', employeeId: 'MD-1', name: 'Admin', roleNames: ['Administrator'], permissions: { manageUsers: true, manageAttendance: true } });
  const today = h.load('lib/attendance.ts').getPhilippineDate();
  const row = (id, date, status, notes, timeIn = '') => [`ATT-${date.replaceAll('-', '')}-${id}`, id, date, 'MATINA', '08:00', '17:00', timeIn, '', 0, 0, status, 0, 0, '', '', notes, '', ''];
  h.rows.Attendance = [['attendance_id'],
    row('MD-5', '2026-10-05', 'AWOL', 'AWOL marked by Admin on 2026-10-05'),
    row('MD-6', '2026-10-05', 'Absent', 'Absent by system: no clock-in by 11:59 PM and not marked by management.'),
    row('MD-7', today, 'Day Off', 'Day Off marked by Admin'),
    row('MD-8', today, 'Present', '', '08:01'),
  ];
  const route = h.load('app/api/attendance-tracking/daily/route.ts');
  const patch = (body) => route.PATCH(new Request('http://localhost/api/attendance-tracking/daily', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'revert', ...body }) }));
  assert.equal((await patch({ attendanceDate: '2026-10-05', employeeIds: ['MD-5'], reason: '' })).status, 400, 'a reason is required');
  const past = await (await patch({ attendanceDate: '2026-10-05', employeeIds: ['MD-5', 'MD-6'], reason: 'Marked by mistake' })).json();
  assert.equal(past.reverted, 1, JSON.stringify(past));
  assert.deepEqual(past.skipped, [{ employeeId: 'MD-6', reason: 'Absent by system, not a mark' }]);
  // The earlier day is rewritten as Absent by system, with who reverted it and why.
  const saved = JSON.stringify(h.writes);
  assert.ok(saved.includes('"ATT-20261005-MD-5","MD-5"') && saved.includes('"Absent"'), saved);
  assert.ok(saved.includes('Absent by system: no clock-in by 11:59 PM and not marked by management. | AWOL mark reverted by Admin') && saved.includes('Marked by mistake'), saved);
  assert.ok(!saved.includes('MD-6'), 'the system absence is left alone');
  const now = await (await patch({ attendanceDate: today, employeeIds: ['MD-7', 'MD-8'], reason: 'Wrong person' })).json();
  assert.equal(now.reverted, 1, JSON.stringify(now));
  assert.deepEqual(now.skipped, [{ employeeId: 'MD-8', reason: 'clocked in' }]);
  const deletes = h.writes.flatMap((write) => write.requestBody?.requests ?? []).filter((item) => item.deleteDimension).map((item) => item.deleteDimension.range.startIndex);
  assert.deepEqual(deletes, [3], 'today only the marked row of MD-7 is removed, so they can still clock in; the clock-in stays');
});

test('a flexible program takes any amount from its minimum, counts months as chosen, and is paid off at its total', () => {
  const h = harness();
  const { accountState, validatePayment } = h.load('lib/account-rules.ts');
  const { calculateRemittance } = h.load('lib/remittance.ts');
  // D-210 style: minimum ₱150 a month, ₱25,200 in total.
  const account = { id: 'E1', memberId: 'M1', memberNumber: 'PH-1', programId: 'D-210', doi: '2026-01-10', branch: 'B', mas: 'M', basePay: 150, payBalanceTotal: 25200, storedStatus: '', flexible: true };
  const pay = (id, from, to, nopFrom, nopTo, amount, orDate) => ({ id, enrollmentId: 'E1', orDate, orNumber: id, monthFrom: from, monthTo: to, nopFrom, nopTo, amount, dateRemitted: orDate, mas: 'M' });
  const history = [pay('P1', '2026-02', '2026-02', 2, 2, 210, '2026-02-05'), pay('P2', '2026-03', '2026-04', 3, 4, 300, '2026-03-05')];
  const state = accountState(account, history, '2026-04-20');
  assert.equal(state.status, 'U', '₱210 for one month and ₱300 for two months are both full months');
  assert.deepEqual(state.allocations.map((item) => item.amount), [210, 150, 150], 'each month is credited with its share of what was paid');
  const input = (amount, months = 1) => ({ monthFrom: '2026-05', monthTo: months === 1 ? '2026-05' : '2026-06', nopFrom: 5, nopTo: 4 + months, amount, orDate: '2026-05-05', orNumber: 'P3', waiver: '', collectedByRole: 'MAS', originalMas: '' });
  assert.throws(() => validatePayment(account, history, input(100), '2026-05-06'), /at least the minimum of 150/);
  assert.throws(() => validatePayment(account, history, input(250, 2), '2026-05-06'), /2 month\(s\) requires at least 300/);
  validatePayment(account, history, input(500), '2026-05-06');  // more than the minimum for one month is fine
  assert.throws(() => validatePayment(account, history, input(30000), '2026-05-06'), /more than the remaining program balance of 24690/);
  // Paid off once collections reach the total.
  assert.equal(accountState({ ...account, payBalanceTotal: 510 }, history, '2026-04-20').status, 'Paid');
  // Incentives follow the amount paid: 50% of (amount - ₱50 mark-up).
  const tiers = [{ role: 'MAS', fromMonth: 1, toMonth: 999, incentiveType: 'percentage', markUp: 50, incentiveAmount: 50 }];
  assert.deepEqual(calculateRemittance(150, tiers, 'MAS', 5, 5, 210, true).breakdown.map((item) => [item.basePay, item.incentive, item.remittance]), [[210, 80, 130]]);
  assert.deepEqual(calculateRemittance(150, tiers, 'MAS', 5, 6, 300, true).breakdown.map((item) => item.basePay), [150, 150]);
  assert.throws(() => calculateRemittance(150, tiers, 'MAS', 5, 6, 250, true), /at least the minimum/);
  // A fixed program is unchanged: every month is the base pay, and only an exact payoff may exceed it.
  assert.throws(() => validatePayment({ ...account, flexible: false, basePay: 210 }, history.map((item) => ({ ...item, amount: 210 * (item.nopTo - item.nopFrom + 1) })), input(500), '2026-05-06'), /must exactly pay the remaining program balance/);
});

test('a returned Collections batch can be edited by its clerk, and only while it is returned', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila(), month = today.slice(0, 7);
  const next = rules.monthName(rules.monthIndex(month) + 1), after = rules.monthName(rules.monthIndex(month) + 2);
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active'], ['PMT-GCASH', 'GCash', false, false, 'active']];
  await seedAccount({ doi: month + '-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('program_incentives', [{ incentive_id: 'I1', program_id: 'DP-1', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '1001 C', orDate: today };
  const saved = await h.load('app/api/collections/route.ts').POST(request({ branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'MAS', paymentMethod: 'GCash', controlTotal: 200, collections: [entry] }));
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
  const [{ collection_id: id }] = await query('select collection_id from collections');
  const route = h.load('app/api/my-entries/batch/route.ts');
  const open = async () => route.GET(new Request(`http://localhost/api/my-entries/batch?ids=${id}`));
  const edit = (changes, batch = {}) => route.POST(request({ ids: [id], dateRemitted: today, paymentMethod: 'GCash', collectedBy: 'MAS', ...batch, entries: [{ id, ...changes }] }));

  // Not returned: nothing can be edited.
  assert.match((await (await open()).json()).message, /Only a batch the approver returned/);
  await query(`update collections set remittance_status = 'Returned'`);
  const loaded = await (await open()).json();
  assert.equal(loaded.success, true, JSON.stringify(loaded));
  assert.deepEqual([loaded.batch.kind, loaded.batch.entries[0].orNumber, loaded.batch.entries[0].nopFrom, loaded.batch.paymentMethod], ['Collection', '1001 C', 2, 'GCash']);

  // Two months instead of one: ₱700, NOP 2-3; a new OR number; the company share follows (₱200 a month).
  assert.match((await (await edit({ amount: 350, monthTo: after })).json()).message, /at least 700/);
  assert.match((await (await edit({ orNumber: '1002' })).json()).message, /letter/);
  const fixed = await edit({ orNumber: '1002 c', orDate: today, amount: 700, monthTo: after }, { paymentMethod: 'Cash', penalty: 20, penaltyNote: 'late turnover' });
  assert.equal(fixed.status, 200, JSON.stringify(await fixed.clone().json()));
  const [row] = await query('select or_number, month_to, nop_to, amount_collected::float8 as amount, remittance_amount::float8 as remit, remittance_method, penalty_amount::float8 as penalty, remittance_status, encoded_by_employee_id from collections');
  assert.deepEqual(row, { or_number: '1002 C', month_to: after, nop_to: 3, amount: 700, remit: 400, remittance_method: 'Cash', penalty: 20, remittance_status: 'Returned', encoded_by_employee_id: 'DPE-0001' });

  // Another clerk cannot edit it.
  h.setUser({ userId: 'USR-2', employeeId: 'DPE-0005', name: 'Other', roleNames: ['Entry Clerk'], permissions: {} });
  assert.match((await (await edit({ amount: 700, monthTo: after })).json()).message, /only batches you encoded/);
});

test('a returned New Sales batch: application number, date and amount can be fixed, and an entry removed', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', 'TRUE', 'FALSE']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const sale = (applicationNo, surname) => ({ existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo, surname, firstName: 'Ana', addressHouse: 'Complete Address', beneficiaries: [] });
  const saved = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 400, sales: [sale('APP-1', 'Uno'), sale('APP-2', 'Dos')] }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  await query(`update sales set remittance_status = 'Returned'`);
  const ids = (await query('select sale_id from sales order by row_seq')).map((row) => row.sale_id);
  const route = h.load('app/api/my-entries/batch/route.ts');
  const loaded = await (await route.GET(new Request(`http://localhost/api/my-entries/batch?ids=${ids.join(',')}`))).json();
  assert.equal(loaded.success, true, JSON.stringify(loaded));
  assert.deepEqual(loaded.batch.entries.map((entry) => entry.applicationNumber), ['APP-1', 'APP-2']);
  const edit = (entries) => route.POST(request({ ids, dateRemitted: '2026-09-25', paymentMethod: 'Cash', entries }));
  assert.match((await (await edit([{ id: ids[0], applicationNumber: 'APP-2' }, { id: ids[1] }])).json()).message, /entered twice/);
  assert.ok(loaded.batch.entries.every((entry) => /^\d{2}:\d{2}$/.test(entry.doiTime)), 'each sale shows its DOI time');
  assert.match((await (await edit([{ id: ids[0], doiTime: '24:10' }, { id: ids[1] }])).json()).message, /DOI time as hours and minutes/);
  const fixed = await edit([{ id: ids[0], applicationNumber: 'APP-10', amount: 700, doiTime: '16:05' }, { id: ids[1], remove: true }]);
  assert.equal(fixed.status, 200, JSON.stringify(await fixed.clone().json()));
  assert.deepEqual([(await query('select doi_time from sales'))[0].doi_time, (await query('select doi_time from member_programs'))[0].doi_time], ['16:05:00', '16:05:00'], 'the DOI time follows on the sale and its account');
  const rows = await query('select application_no, amount_paid::float8 as amount, remittance_amount::float8 as remit, remittance_status from sales');
  assert.deepEqual(rows, [{ application_no: 'APP-10', amount: 700, remit: 550, remittance_status: 'Returned' }], 'the removed sale is gone; the kept one is fixed');
  assert.equal(await count('members'), 1, 'the removed sale\'s new member went with it');
});

test('a returned New Sales batch can go to another MAS, only one in Clearing that day (October 21, 2026)', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active'], ['DPE-0003', 'right-mas', 'BR-1', 'MAS', 'active'], ['DPE-0004', 'uncleared-mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1'], ['EBA-2', 'DPE-0003', 'BR-1'], ['EBA-3', 'DPE-0004', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', 'TRUE', 'FALSE']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  await seed('employees', [{ employee_id: 'DPE-0003', full_name: 'right-mas' }, { employee_id: 'DPE-0004', full_name: 'uncleared-mas' }], { skipExisting: true });
  const saved = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 200,
    sales: [{ existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', surname: 'Uno', firstName: 'Ana', addressHouse: 'Address', beneficiaries: [] }] }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  await query("update sales set remittance_status = 'Returned'");
  const ids = (await query('select sale_id from sales')).map((row) => row.sale_id);
  const route = h.load('app/api/my-entries/batch/route.ts');
  globalThis.dayongClearingNotRequired = false;
  try {
    await seed('clearings', [
      { clearing_id: 'CLR-A', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'different-mas', cleared_at: '2026-09-25T02:00:00Z', cleared_date: '2026-09-25', status: 'Open' },
      { clearing_id: 'CLR-B', branch: 'BR-1', employee_id: 'DPE-0003', employee_name: 'right-mas', cleared_at: '2026-09-25T02:10:00Z', cleared_date: '2026-09-25', status: 'Open' },
    ]);
    const loaded = await (await route.GET(new Request(`http://localhost/api/my-entries/batch?ids=${ids.join(',')}`))).json();
    assert.equal(loaded.batch.personEmployeeId, 'DPE-0002');
    assert.deepEqual(loaded.batch.masChoices.map((choice) => [choice.id, choice.cleared]), [['DPE-0002', true], ['DPE-0003', true], ['DPE-0004', false]], 'only MAS in Clearing that day can be chosen');
    const edit = (masEmployeeId) => route.POST(request({ ids, masEmployeeId, dateRemitted: '2026-09-25', paymentMethod: 'Cash', entries: [{ id: ids[0] }] }));
    assert.match((await (await edit('DPE-0004')).json()).message, /uncleared-mas is not in Clearing/);
    const moved = await (await edit('DPE-0003')).json();
    assert.equal(moved.success, true, JSON.stringify(moved));
    assert.match(moved.message, /now goes to right-mas/);
    assert.deepEqual(await query('select mas, accountable_employee_id, remittance_status from sales'), [{ mas: 'right-mas', accountable_employee_id: 'DPE-0003', remittance_status: 'Returned' }]);
    assert.deepEqual(await query('select mas from member_programs'), [{ mas: 'right-mas' }], 'the account follows the MAS');
  } finally { globalThis.dayongClearingNotRequired = true; }
});

test('a program deactivated for a member takes no collections, leaves the account lists, and can be reactivated (October 17, 2026)', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', 'TRUE', 'FALSE']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const saved = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 200,
    sales: [{ existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', surname: 'Uno', firstName: 'Ana', addressHouse: 'Address', beneficiaries: [] }] }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const [{ enrollment_id: id, member_id: memberId }] = await query('select enrollment_id, member_id from member_programs');
  h.setUser({ userId: 'U1', employeeId: 'DPE-0001', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  const route = h.load('app/api/members/account-status/route.ts');
  const post = async (body) => (await route.POST(request(body))).json();
  await query(`update sales set remittance_status = 'Pending Remittance Approval'`);
  assert.match((await post({ enrollmentId: id, active: false, reason: 'Member dropped it' })).message, /still waiting on a remittance/, 'settle pending entries first');
  await query(`update sales set remittance_status = 'Remitted'`);
  assert.match((await post({ enrollmentId: id, active: false, reason: '' })).message, /reason/);
  const off = await post({ enrollmentId: id, active: false, reason: 'Member dropped it' });
  assert.equal(off.success, true, JSON.stringify(off));
  assert.deepEqual(await query('select status from member_programs'), [{ status: 'Deactivated' }]);
  const { loadAccountData } = h.load('lib/account-data.ts');
  assert.equal((await loadAccountData({ memberId })).accounts.length, 0, 'left out of MAM, statuses and Collections');
  assert.equal((await loadAccountData({ memberId, includeDeactivated: true })).accounts.length, 1, 'still there for corrections and the statement');
  assert.equal(await count('sales'), 1, 'its New Sale stays');
  const collections = await h.load('app/api/collections/route.ts').GET(new Request(`http://localhost/api/collections?memberId=${memberId}&programId=DP-1&branch=BR-1&mas=different-mas`));
  assert.equal(collections.status, 404);
  assert.match((await collections.json()).message, /deactivated for this member takes no collections/);
  assert.match((await post({ enrollmentId: id, active: false, reason: 'again' })).message, /already deactivated/);
  const on = await post({ enrollmentId: id, active: true, reason: 'Member resumed' });
  assert.equal(on.success, true, JSON.stringify(on));
  assert.deepEqual(await query('select status from member_programs'), [{ status: 'Active' }]);
  h.setUser({ userId: 'U2', employeeId: 'DPE-0005', name: 'clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.match((await post({ enrollmentId: id, active: false, reason: 'Member dropped it' })).message, /Only Administrators, HR Officers and IT/);
});

test('a returned New Sale: every detail can be corrected and the member record follows (October 17, 2026)', async () => {
  const h = harness();
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Employees = [[], ['DPE-0002', 'different-mas', 'BR-1', 'MAS', 'active', '09170000002']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350, 'active', '', '', '', '', '', 'No', 0, 0, '', '', '', '', '', '', 'TRUE', 'FALSE']];
  h.rows['Program Incentives'] = [[], ['INC-1', 'DP-1', 'MAS', 1, 12, 'percentage', 50, 50]];
  await seedSaleLinks([['DP-1', 'Program']], ['DPE-0002', 'different-mas']);
  const saved = await h.load('app/api/sales/route.ts').POST(request({ branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25', controlTotal: 200,
    sales: [{ existingMember: false, programId: 'DP-1', amountPaid: '350', applicationNo: 'APP-1', surname: 'Uno', firstName: 'Ana', birthdate: '1980-01-02', contactNumber: '09171112222', addressHouse: 'Old Address', beneficiaries: [] }] }));
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  await query(`update sales set remittance_status = 'Returned'`);
  const [{ sale_id: id }] = await query('select sale_id from sales');
  const route = h.load('app/api/my-entries/batch/route.ts');
  const loaded = await (await route.GET(new Request(`http://localhost/api/my-entries/batch?ids=${id}`))).json();
  assert.equal(loaded.success, true, JSON.stringify(loaded));
  const sale = loaded.batch.entries[0].sale;
  assert.deepEqual([sale.surname, sale.birthdate, sale.contactNumber, sale.address, sale.beneficiaries.length, sale.hasCollections], ['Uno', '1980-01-02', '09171112222', 'Old Address', 0, false]);
  const edit = (patch, applicationNumber = 'APP-1') => route.POST(request({ ids: [id], dateRemitted: '2026-09-25', paymentMethod: 'Cash', entries: [{ id, applicationNumber, sale: { ...sale, ...patch } }] }));
  assert.match((await (await edit({}, 'APP1')).json()).message, /with its dash/, 'an application number needs its dash');
  const { isIncompleteApplicationNumber } = h.load('lib/entry-controls.ts');
  for (const ok of ['2026SP-00154', '2026 SP-154', 'APP-1']) assert.equal(isIncompleteApplicationNumber(ok), false, ok);
  for (const bad of ['2026SP', '2026 SP-', '2026SP00154', '00154', '']) assert.equal(isIncompleteApplicationNumber(bad), true, bad);
  assert.match((await (await edit({ contactNumber: '12345' })).json()).message, /Philippine mobile format/);
  assert.match((await (await edit({ claimantContact: '0917 000 0002' })).json()).message, /belongs to employee different-mas/);
  assert.match((await (await edit({ beneficiaries: [{ surname: 'Dos', firstName: '', middleName: '', birthdate: '', relationship: 'Son' }] })).json()).message, /each beneficiary needs/);
  const fixed = await edit({ surname: 'Unoh', middleName: 'Cruz', birthdate: '1981-03-04', contactNumber: '09173334444', address: 'New Address', claimantName: 'Ben Unoh', claimantContact: '09175556666', claimantSameAddress: true,
    beneficiaries: [{ surname: 'Unoh', firstName: 'Cara', middleName: '', birthdate: '2010-05-06', relationship: 'Daughter' }] });
  assert.equal(fixed.status, 200, JSON.stringify(await fixed.clone().json()));
  const [row] = await query('select surname, middle_name, birthdate::text as birthdate, member_contact, address, claimant_name, claimant_address, remittance_status from sales');
  assert.deepEqual(row, { surname: 'Unoh', middle_name: 'Cruz', birthdate: '1981-03-04', member_contact: '09173334444', address: 'New Address', claimant_name: 'Ben Unoh', claimant_address: 'New Address', remittance_status: 'Returned' });
  const [member] = await query('select surname, middle_name, birthdate::text as birthdate, member_contact, address from members');
  assert.deepEqual(member, { surname: 'Unoh', middle_name: 'Cruz', birthdate: '1981-03-04', member_contact: '09173334444', address: 'New Address' }, 'the member record follows');
  assert.deepEqual(await query('select surname, first_name, relationship, sale_id from beneficiaries'), [{ surname: 'Unoh', first_name: 'Cara', relationship: 'Daughter', sale_id: id }]);
});

test('entry deadlines skip Sundays and declared non-working days', async () => {
  const h = harness();
  const { needsBackdateReason } = h.load('lib/entry-controls.ts');
  const { incentiveDeadline } = h.load('lib/remittance-deadline.ts');
  // 2026-10-10 is a Saturday, 10-11 a Sunday, 10-12 a Monday.
  assert.equal(incentiveDeadline("2026-10-10"), "2026-10-12 15:00", "a Saturday OR is due Monday 3:00 PM");
  assert.equal(incentiveDeadline("2026-10-08"), "2026-10-09 15:00", "a Thursday OR is due Friday");
  assert.equal(needsBackdateReason("2026-10-10", "2026-10-12"), false, "on Monday a Saturday OR is not late");
  assert.equal(needsBackdateReason("2026-10-09", "2026-10-12"), true, "on Monday a Friday OR is late");
  // Monday declared non-working for BR-1 only: Saturday's OR is due Tuesday there, Monday elsewhere.
  const closed = { days: [{ date: "2026-10-12", allBranches: false, branchNames: ["BR-1"] }] };
  assert.equal(incentiveDeadline("2026-10-10", { ...closed, branch: "BR-1" }), "2026-10-13 15:00");
  assert.equal(incentiveDeadline("2026-10-10", { ...closed, branch: "BR-2" }), "2026-10-12 15:00");
  assert.equal(needsBackdateReason("2026-10-10", "2026-10-13", { ...closed, branch: "br-1" }), false, "Tuesday after a closed Monday: Saturday is still on time");
  assert.equal(needsBackdateReason("2026-10-10", "2026-10-13", { ...closed, branch: "BR-2" }), true);
});

test('a program code is used by one program only', async () => {
  const h = harness();
  await seed('programs', [{ program_id: 'DP-0004', program_code: '320', program_name: 'DS-320', base_pay: 320 }, { program_id: 'DP-0011', program_code: 'D-320', program_name: 'D-320', base_pay: 320 }]);
  const { assertProgramCodeFree } = h.load('lib/google-sheets-data.ts');
  const { currentDb } = h.load('lib/db.ts');
  await assert.rejects(assertProgramCodeFree(currentDb(), ' 320 '), /Program code 320 is already used by DS-320/);
  await assert.rejects(assertProgramCodeFree(currentDb(), 'd-320', 'DP-0004'), /already used by D-320/, 'case does not matter');
  await assertProgramCodeFree(currentDb(), '320', 'DP-0004');
  await assertProgramCodeFree(currentDb(), 'DS-320');
});

test('Collections find the account when its MAS name differs only in capitals', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila(), month = today.slice(0, 7);
  const next = rules.monthName(rules.monthIndex(month) + 1);
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active'], ['PMT-GCASH', 'GCash', false, false, 'active']];
  // The account keeps the MAS as first encoded; the employee (and Clearing) spell it in capitals.
  await seedAccount({ doi: month + '-01', mas: 'mas-2 ' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('program_incentives', [{ incentive_id: 'I1', program_id: 'DP-1', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  const route = h.load('app/api/collections/route.ts');
  const found = await route.GET(new Request(`http://localhost/api/collections?memberId=MEM-1&programId=DP-1&branch=BR-1&mas=MAS-2`));
  assert.equal(found.status, 200, JSON.stringify(await found.clone().json()));
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '1001 C', orDate: today };
  const saved = await route.POST(request({ branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collectedBy: 'MAS', paymentMethod: 'GCash', controlTotal: 200, collections: [entry] }));
  assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
});

test('the Attendance Review number counts unmarked system absences of listed employees only', async () => {
  const h = harness();
  h.rows.Users = [[]];
  h.rows.Employees = [[], ['DPE-0002', 'Active One', 'BR-1', 'MAS', 'active'], ['DPE-0003', 'Active Two', 'BR-1', 'MAS', 'active'], ['DPE-0004', 'Left', 'BR-1', 'MAS', 'inactive']];
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'Active One', employment_status: 'Active' }, { employee_id: 'DPE-0003', full_name: 'Active Two', employment_status: 'Active' }, { employee_id: 'DPE-0004', full_name: 'Left', employment_status: 'Inactive' }]);
  const { systemAbsencesWaiting, SYSTEM_ABSENCE_NOTE } = h.load('lib/auto-absence.ts');
  const absent = (id, employee, date) => ({ attendance_id: id, employee_id: employee, attendance_date: date, attendance_status: 'Absent', notes: SYSTEM_ABSENCE_NOTE });
  await seed('attendance', [
    absent('A1', 'DPE-0002', '2026-10-12'), absent('A2', 'DPE-0003', '2026-10-12'),
    absent('A3', 'DPE-0004', '2026-10-12'),                       // no longer active: not listed in the review, not counted
    absent('A4', 'DPE-0002', '2026-10-08'), absent('A5', 'DPE-0002', '2026-10-08'), // a repeated system row counts once
    absent('A6', 'DPE-0003', '2026-10-08'),
    { attendance_id: 'A7', employee_id: 'DPE-0003', attendance_date: '2026-10-08', attendance_status: 'Not Required', notes: 'No attendance needed marked by admin on 2026-10-13' }, // marked: replaces it
    absent('A8', 'DPE-0002', '2026-10-01'),                       // older than a week
  ]);
  assert.deepEqual(await systemAbsencesWaiting('2026-10-13'), [{ date: '2026-10-12', count: 2 }, { date: '2026-10-08', count: 1 }]);
});

test('a clearing for both kinds stays in the New Sales list while only its Collections are encoded', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await seedAccount({ doi: yesterday });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }, { employee_id: 'DPE-0003', full_name: 'MAS-3' }]);
  await seed('clearings', [
    // Both, cleared yesterday; its cash Collections went for approval, which marked it Encoded. No New Sales yet.
    { clearing_id: 'CLR-HALF', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${yesterday}T01:00:00Z`, cleared_date: yesterday, status: 'Encoded', covers: 'Both' },
    // Collections only, yesterday, encoded: nothing left to encode.
    { clearing_id: 'CLR-DONE', branch: 'BR-1', employee_id: 'DPE-0003', employee_name: 'MAS-3', cleared_at: `${yesterday}T01:00:00Z`, cleared_date: yesterday, status: 'Encoded', covers: 'Collections' },
  ]);
  await seed('collections', [
    { collection_id: 'COL-H1', collection_batch_id: 'CBT-H', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: '2001 C', amount_collected: 350, status: 'Posted', remittance_status: 'Pending Remittance Approval', accountable_employee_id: 'DPE-0002', date_remitted: yesterday, encoded_at: `${yesterday}T02:00:00Z`, remittance_method: 'Cash' },
    { collection_id: 'COL-D1', collection_batch_id: 'CBT-D', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: '2002 C', amount_collected: 350, status: 'Posted', remittance_status: 'Pending Remittance Approval', accountable_employee_id: 'DPE-0003', date_remitted: yesterday, encoded_at: `${yesterday}T02:00:00Z`, remittance_method: 'Cash' },
  ]);
  const clearing = h.load('lib/clearing.ts');
  const listed = await clearing.getEncodableClearings('');
  assert.deepEqual(listed.map((item) => [item.id, item.waitingKinds]), [['CLR-HALF', ['New Sales']]], 'listed for New Sales only; the finished one is not listed');
  assert.equal(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', yesterday, 'New Sales'), '', 'its New Sales can still be saved for that day');
});

test('a person cleared for New Sales only can be cleared for Collections the same day, not twice for one kind', async () => {
  const h = harness();
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-1', 'DPE-0002', 'BR-1']];
  await seed('branches', [{ branch_id: 'BR-1', branch_name_code: 'BR-1', status: 'active' }]);
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2', employment_status: 'Active' }]);
  await seed('employee_branches', [{ assignment_id: 'EBA-1', employee_id: 'DPE-0002', branch_id: 'BR-1' }]);
  const clearing = h.load('lib/clearing.ts');
  const { runAsSystem } = h.load('lib/encoder-context.ts');
  await runAsSystem(() => clearing.addClearing({ branch: 'BR-1', employeeId: 'DPE-0002', covers: 'New Sales' }));
  await runAsSystem(() => clearing.addClearing({ branch: 'BR-1', employeeId: 'DPE-0002', covers: 'Collections' }));
  await assert.rejects(() => runAsSystem(() => clearing.addClearing({ branch: 'BR-1', employeeId: 'DPE-0002', covers: 'Both' })), /already cleared for New Sales and Collections in BR-1 today/);
  await assert.rejects(() => runAsSystem(() => clearing.addClearing({ branch: 'BR-1', employeeId: 'DPE-0002', covers: 'Collections' })), /already cleared for Collections in BR-1 today/);
  assert.deepEqual((await query("select covers from clearings where status = 'Open' order by covers")).map((row) => row.covers), ['Collections', 'New Sales']);
});

test('a DTO batch: a member of a resigned MAS paid at the office, without a clearing; the clerk is accountable', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila(), month = today.slice(0, 7);
  const next = rules.monthName(rules.monthIndex(month) + 1);
  // DPE-0001 is the signed-in clerk; DPE-0009 the MAS who resigned. Nobody is in Clearing.
  h.rows.Employees = [[], ['DPE-0001', '=encoder', 'BR-1', 'Entry Clerk', 'active'], ['DPE-0009', 'Old MAS', 'BR-1', 'MAS', 'resigned']];
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows['Employee Branches'] = [[], ['EBA-9', 'DPE-0009', 'BR-1']];
  h.rows['Remittance Methods'] = [[], ['PMT-CASH', 'Cash', true, false, 'active']];
  await seedAccount({ doi: month + '-01', mas: 'Old MAS' });
  await seed('employees', [{ employee_id: 'DPE-0001', full_name: '=encoder' }, { employee_id: 'DPE-0009', full_name: 'Old MAS' }]);
  await seed('program_incentives', [{ incentive_id: 'I1', program_id: 'DP-1', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  const route = h.load('app/api/collections/route.ts');
  globalThis.dayongClearingNotRequired = false;
  try {
    const found = await route.GET(new Request('http://localhost/api/collections?memberId=MEM-1&programId=DP-1&branch=BR-1&mas=&dto=1'));
    assert.equal(found.status, 200, 'any account of the branch, whatever its MAS');
    const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: next, monthTo: next, amountCollected: 350, nopFrom: 2, nopTo: 2, orNumber: '3001 C', orDate: today };
    const batch = { dto: true, branch: 'BR-1', mas: 'ignored', accountableEmployeeId: 'DPE-0009', dateRemitted: today, collectedBy: 'MAS', paymentMethod: 'Cash', controlTotal: 350, collections: [entry] };
    const penalized = await route.POST(request({ ...batch, penalty: 50, penaltyNote: 'Late' }));
    assert.equal(penalized.status, 400);
    assert.match((await penalized.json()).message, /no MAS to charge a penalty/);
    const saved = await route.POST(request(batch));
    assert.equal(saved.status, 201, JSON.stringify(await saved.clone().json()));
    const [row] = await query('select mas, accountable_employee_id, accountable_name, accountable_role, collected_by_role, remittance_amount from collections');
    assert.deepEqual({ ...row, remittance_amount: Number(row.remittance_amount) },
      { mas: 'Old MAS', accountable_employee_id: 'DPE-0001', accountable_name: '=encoder', accountable_role: 'DTO', collected_by_role: 'DTO', remittance_amount: 350 },
      'the account keeps its MAS; the clerk is accountable; DTO earns no incentive, so all ₱350 is remitted');
    const { entries } = await h.load('lib/todays-entries.ts').getEntriesForRange(today, today, 'encoded', {});
    assert.deepEqual(entries.map((entry) => entry.person), ['DTO'], 'shown as DTO, not the clerk or the MAS');
  } finally { globalThis.dayongClearingNotRequired = true; }
});

test('an Entry Clerk report is per branch for a clerk who encodes for several', async () => {
  const h = harness();
  const collection = (id, branch, amount, net) => { const row = Array(41).fill(''); Object.assign(row, { 0: id, 5: 'DP-1', 6: branch, 7: 'Maria', 9: '2026-09-03', 10: amount, 19: 'Posted', 20: '2026-09-03T02:00:00.000Z', 22: 'DPE-7', 24: '2026-09-03T02:00:00.000Z', 26: net, 28: 'Outstanding', 31: 'Maria' }); return row; };
  h.rows.Collections = [[], collection('COL-A', 'AGDAO', 1000, 900), collection('COL-T', 'TORIL', 500, 450)];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program']];
  h.rows['Bank Deposits'] = [[],
    ['DEP-A', '2026-09-03', 'DPE-7', 'Clerk', 'AGDAO', 'DSRDPI', 700, 'RCBC', '', '', 'Posted', '', ''],
    ['DEP-T', '2026-09-03', 'DPE-7', 'Clerk', 'TORIL', 'DSRDPI', 300, 'RCBC', '', '', 'Posted', '', ''],
  ];
  // Notes saved before reports were split (no branch in the key) belong to the primary branch (AGDAO).
  h.rows['Report Notes'] = [[],
    ['DPE-7|daily|2026-09-03', 'DPE-7', 'daily', '2026-09-03', 120, 'Old notes', '', '', '', ''],
    ['DPE-7|daily|2026-09-03|TORIL', 'DPE-7', 'daily', '2026-09-03', 0, 'Toril notes', '', '', '', '', 50, 'Counted at Toril', '', 'Clerk'],
  ];
  await h.sync();
  const { buildClerkReport } = h.load('lib/clerk-report.ts');
  const clerk = { employeeId: 'DPE-7', name: 'Clerk', branch: 'AGDAO' };
  const agdao = await buildClerkReport('daily', '2026-09-03', clerk, 'AGDAO');
  assert.deepEqual([agdao.branch, agdao.collection.total.gross, agdao.cash.forwardedToBank, agdao.notes.specificRemarks, agdao.cash.pendingCash, agdao.cash.cashBeg], ['AGDAO', 1000, 700, 'Old notes', 120, 0]);
  const toril = await buildClerkReport('daily', '2026-09-03', clerk, 'toril');
  assert.deepEqual([toril.collection.total.gross, toril.cash.forwardedToBank, toril.notes.specificRemarks, toril.cash.pendingCash, toril.cash.cashBeg], [500, 300, 'Toril notes', 0, 50], 'case does not matter');
  assert.deepEqual(toril.encodedBranches, ['AGDAO', 'TORIL'], 'every branch encoded in the period is offered');
  const all = await buildClerkReport('daily', '2026-09-03', clerk);
  assert.deepEqual([all.collection.total.gross, all.cash.forwardedToBank], [1500, 1000], 'every branch (Audits)');
  assert.deepEqual(all.byBranch.map((line) => [line.branch, line.gross]), [['AGDAO', 1000], ['TORIL', 500]], 'Audits show each branch, each equal to its own report');
  assert.equal(all.notes.specificRemarks, 'Old notes\n\nTORIL: Toril notes', "All branches (Audits) shows every branch's notes, labelled by branch");
  assert.equal(all.notes.pendingCash, 120);
  assert.equal(all.cash.cashBeg, 50, "each branch's typed Cash Beg added together");
});

test('Clearing shows who approved or returned each kind', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila();
  await seedAccount({ doi: today });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('clearings', [{ clearing_id: 'CLR-D', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T00:30:00Z`, cleared_date: today, status: 'Encoded', covers: 'Collections' }]);
  await seed('remittances', [{ remittance_id: 'REM-D', branch: 'BR-1', mas: 'MAS-2', date_remitted: today, status: 'Approved', decision_by_name: 'BAUTISTA, JO-ANN E.', decision_at: `${today}T02:15:00Z` }]);
  await seed('collections', [{ collection_id: 'COL-D', collection_batch_id: 'CBT-D', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: '4001 C', amount_collected: 350, status: 'Posted', remittance_status: 'Remitted', linked_remittance_id: 'REM-D', accountable_employee_id: 'DPE-0002', date_remitted: today, encoded_at: `${today}T01:00:00Z`, remittance_method: 'Cash' }]);
  const clearing = h.load('lib/clearing.ts');
  const [line] = await clearing.withProgress((await clearing.getClearingPage('')).clearings.filter((item) => item.id === 'CLR-D'));
  assert.equal(line.stage, 'Approved');
  assert.deepEqual(line.kinds[0].decisions, [{ status: 'Approved', by: 'BAUTISTA, JO-ANN E.', at: `${today} 10:15` }]);
});

test('a clearing for both kinds still covers an earlier Date Remitted for the kind not yet encoded', async () => {
  const h = harness();
  const rules = h.load('lib/account-rules.ts');
  const today = rules.todayInManila();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await seedAccount({ doi: yesterday });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  // Cleared today for both; the Collections (Date Remitted moved to yesterday) went for approval, so it is Encoded.
  await seed('clearings', [{ clearing_id: 'CLR-B', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T00:30:00Z`, cleared_date: today, status: 'Encoded', covers: 'Both' }]);
  await seed('collections', [{ collection_id: 'COL-B', collection_batch_id: 'CBT-B', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: '5001 C', amount_collected: 350, status: 'Posted', remittance_status: 'Pending Remittance Approval', accountable_employee_id: 'DPE-0002', date_remitted: yesterday, encoded_at: `${today}T01:00:00Z`, remittance_method: 'Cash' }]);
  const clearing = h.load('lib/clearing.ts');
  globalThis.dayongClearingNotRequired = false;
  try {
    assert.equal(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', yesterday, 'New Sales'), '', 'its New Sales are still waiting');
    assert.match(await clearing.clearingProblem('DPE-0002', 'MAS-2', 'BR-1', yesterday, 'Collections'), /not in Clearing for Collections/, 'its Collections are already encoded');
  } finally { globalThis.dayongClearingNotRequired = true; }
});

test('a Date Remitted moved earlier with a reason counts the cash as received that day', async () => {
  const h = harness();
  await seedAccount({ doi: '2026-09-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  // Cleared on Tuesday the 13th at 12:08; the MAS really remitted on Monday the 12th (entry clerks' meeting).
  await seed('clearings', [{ clearing_id: 'CLR-M', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: '2026-10-13T04:08:00Z', cleared_date: '2026-10-13', status: 'Open', covers: 'Both' }]);
  const row = (id, reason) => ({ collection_id: id, collection_batch_id: `CBT-${id}`, enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: `${id} C`, amount_collected: 350, status: 'Posted', remittance_status: 'Outstanding', accountable_employee_id: 'DPE-0002', date_remitted: '2026-10-12', date_remitted_reason: reason, encoded_at: '2026-10-13T06:12:00Z', remittance_method: 'Cash' });
  await seed('collections', [row('M1', "Entry clerks' meeting"), row('M2', null)]);
  const { receivedAtOf } = h.load('lib/remittance-workflow.ts');
  const item = (id) => ({ id, encodedAt: '2026-10-13 14:12', dateRemitted: '2026-10-12', accountableEmployeeId: 'DPE-0002', branch: 'BR-1', kind: 'Collections' });
  assert.deepEqual(await receivedAtOf([item('M1')]), { date: '2026-10-12', time: '00:00' }, 'moved with a reason: received on the Date Remitted');
  assert.deepEqual(await receivedAtOf([item('M2')]), { date: '2026-10-13', time: '12:08' }, 'no reason: the clearing time, as before');
  // OR dated Sunday the 11th: due 3:00 PM Monday the 12th, so the moved batch keeps its incentive.
  assert.equal(h.load('lib/remittance-deadline.ts').keepsIncentive('2026-10-11', '2026-10-12 00:00'), true);
  // Remittances shows why the Date Remitted was changed (October 19, 2026).
  const { dateRemittedReasons } = h.load('lib/remittance-workflow.ts');
  assert.deepEqual([...await dateRemittedReasons()], [['M1', { date: '2026-10-12', reason: "Entry clerks' meeting" }]], 'only entries with a reason');
  assert.equal((await dateRemittedReasons(['M2'])).size, 0);
  assert.equal((await dateRemittedReasons([])).size, 0);
});

test('Remittances explains a discrepancy: balanced when made, then a correction raised one entry share', async () => {
  const h = harness();
  await seedAccount({ doi: '2026-09-01' });
  await seed('remittances', [{ remittance_id: 'REM-D', branch: 'BR-1', status: 'Pending Approval', remittance_type: 'Collections', created_at: '2026-10-17T03:20:28Z', date_remitted: '2026-10-17', time_remitted: '11:00', gross_collection: 404.8, total_remittance: 404.8, difference: 0, fidelity_amount: 0 }]);
  await seed('collections', [{ collection_id: 'C-D', collection_batch_id: 'CBT-D', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: '08878T', amount_collected: 460, status: 'Posted', remittance_status: 'Pending Remittance Approval', linked_remittance_id: 'REM-D', remittance_amount: 404.8, encoded_by_employee_id: 'DPE-0007' }]);
  await seed('remittance_collections', [{ remittance_collection_id: 'RCL-D', remittance_id: 'REM-D', collection_id: 'C-D', amount: 404.8 }]);
  // A correction moves the entry to another program; its share and the slip follow (as followSlip does).
  await query(`select set_config('app.user_name', 'it clerk', false)`);
  await query(`update collections set remittance_amount = 414 where collection_id = 'C-D'`);
  await query(`update remittance_collections set amount = 414 where remittance_collection_id = 'RCL-D'`);
  await query(`update remittances set gross_collection = 414, difference = -9.2 where remittance_id = 'REM-D'`);
  await query(`select set_config('app.user_name', '', false)`);
  await seed('record_corrections', [{ correction_id: 'COR-D', module: 'Edit Collection', record_id: 'C-D', reason: 'D-460 to D-460 (59B)', corrected_at: new Date().toISOString() }]);
  const { getDiscrepancyBreakdown } = h.load('lib/remittance-discrepancy.ts');
  const result = await getDiscrepancyBreakdown('REM-D');
  assert.deepEqual([result.expected, result.actual, result.difference, result.expectedAtStart, result.actualAtStart], [414, 404.8, -9.2, 404.8, 404.8]);
  assert.match(result.causes[0], /balanced when it was made/);
  assert.match(result.causes[1], /expected amount went up by ₱9\.20 .*entry C-D \(OR 08878T\) was corrected: "D-460 to D-460 \(59B\)", by it clerk/);
  assert.deepEqual(result.changes.map((change) => [change.what, change.from, change.to, change.entryId]), [['Entry share', 404.8, 414, 'C-D'], ['Expected', 404.8, 414, 'C-D']]);
  assert.deepEqual(result.entries.map((entry) => [entry.id, entry.shareOnSlip, entry.shareNow]), [['C-D', 414, 414]]);
  await assert.rejects(getDiscrepancyBreakdown('REM-D', 'DPE-0099'), /only view remittances you encoded/);
  await assert.rejects(getDiscrepancyBreakdown('REM-NONE'), /not found/);
});

test('the clearing receipt time survives Encoded status and late encoding for either kind', async () => {
  const h = harness();
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('clearings', [
    { clearing_id: 'CLR-RECEIPT', branch: 'BR-1', employee_id: 'DPE-0002', cleared_at: '2026-09-26T06:59:00Z', cleared_date: '2026-09-26', status: 'Open', covers: 'Both' },
    { clearing_id: 'CLR-FUTURE', branch: 'BR-1', employee_id: 'DPE-0002', cleared_at: '2026-09-27T01:00:00Z', cleared_date: '2026-09-27', status: 'Encoded', covers: 'Both' },
  ]);
  const { clearedAt } = h.load('lib/clearing.ts');
  for (const kind of ['Collections', 'New Sales']) {
    assert.equal(await clearedAt('DPE-0002', ' br-1 ', '2026-09-25', '2026-09-26 16:00', kind), '2026-09-26 14:59');
  }
  await query("update clearings set status='Encoded' where clearing_id='CLR-RECEIPT'");
  for (const kind of ['Collections', 'New Sales']) {
    assert.equal(await clearedAt('DPE-0002', 'BR-1', '2026-09-25', '2026-09-26 16:00', kind), '2026-09-26 14:59', 'Encoded does not erase when cash was received');
  }
  await query("update clearings set status='Removed' where clearing_id='CLR-RECEIPT'");
  assert.equal(await clearedAt('DPE-0002', 'BR-1', '2026-09-25', '2026-09-26 16:00', 'Collections'), '', 'neither a removed nor a future clearing counts');
});

test('remittance totals and automatic submission keep incentives for on-time clearing after 3 PM', async () => {
  const h = harness();
  deadlineHeaders(h);
  h.rows.Remittances[0][12] = 'Difference';
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  await seedAccount({ doi: '2026-09-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }, { employee_id: 'DPE-0003', full_name: 'Late MAS' }]);
  await seed('clearings', [{ clearing_id: 'CLR-ONTIME', branch: 'BR-1', employee_id: 'DPE-0002', cleared_at: '2026-09-26T07:00:00Z', cleared_date: '2026-09-26', status: 'Encoded', covers: 'Both' }]);
  await seed('remittances', [{ remittance_id: 'REM-PENDING', status: 'Pending Approval' }]);
  const row = (id, extra = {}) => ({ collection_id: id, collection_batch_id: `CBT-${id}`, enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', mas: 'MAS-2', accountable_name: 'MAS-2', or_number: `${id} C`, or_date: '2026-09-25', amount_collected: 350, remittance_amount: 270, status: 'Posted', remittance_status: 'Outstanding', accountable_employee_id: 'DPE-0002', date_remitted: '2026-09-26', encoded_at: '2026-09-26T08:00:00Z', remittance_method: 'Cash', ...extra });
  await seed('collections', [row('ONTIME'), row('PENDING', { remittance_status: 'Pending Remittance Approval', linked_remittance_id: 'REM-PENDING' }), row('LATE', { accountable_employee_id: 'DPE-0003', accountable_name: 'Late MAS' })]);
  const workflow = h.load('lib/remittance-workflow.ts');
  const dashboard = await workflow.getRemittanceDashboard();
  assert.equal(dashboard.summary.outstandingAmount, 890, '270 on-time + 270 pending as recorded + 350 genuinely late');
  assert.equal(dashboard.accountability.find((item) => item.employeeId === 'DPE-0002').outstandingAmount, 540, 'waiting for approval never makes cleared cash late');
  assert.equal((await workflow.submitReadyEntries(['ONTIME'])).length, 1);
  const requests = h.writes.at(-1).requestBody.requests;
  const slip = requests[0].appendCells.rows[0].values.map((cell) => cell.userEnteredValue.stringValue ?? cell.userEnteredValue.numberValue);
  assert.equal(slip[10], 270, 'encoding at 4 PM keeps the incentive when cleared by 3 PM');
  assert.equal(slip[26], '15:00', 'the slip records the clearing time, including the exact cutoff');
  assert.equal(requests.some((request) => request.updateCells?.range.startColumnIndex === 38), false, 'no forfeiture is written');
});

test('a clerk can edit their own deposit (not a voided one, not another clerk\'s)', async () => {
  const h = harness();
  h.rows['Bank Deposits'] = [[],
    ['DEP-1', '2026-10-12', 'DPE-7', 'Clerk', 'MINTAL', 'DSRDPI', 992, 'RCBC', 'SUYMAN, NELSON', '', 'Posted', '', ''],
    ['DEP-2', '2026-10-12', 'DPE-7', 'Clerk', 'MINTAL', 'DSRDPI', 50, 'RCBC', '', '', 'Voided', 'Typed twice', ''],
  ];
  const { editDeposit } = h.load('lib/clerk-cash.ts');
  const { runAsSystem } = h.load('lib/encoder-context.ts');
  const changes = { date: '2026-10-13', bankAccount: 'DSRDPI', amount: 990, transferType: 'RCBC', mas: 'SUYMAN, NELSON', remarks: 'Ref 01101026001363' };
  await runAsSystem(() => editDeposit('DEP-1', changes, { employeeId: 'DPE-7', isAdmin: false }));
  const [dateWrite, restWrite] = h.writes.slice(-2);
  assert.deepEqual([dateWrite.range, dateWrite.requestBody.values], ["'Bank Deposits'!B2:B2", [['2026-10-13']]]);
  assert.deepEqual([restWrite.range, restWrite.requestBody.values], ["'Bank Deposits'!F2:J2", [['DSRDPI', 990, 'RCBC', 'SUYMAN, NELSON', 'Ref 01101026001363']]]);
  await assert.rejects(() => runAsSystem(() => editDeposit('DEP-1', changes, { employeeId: 'DPE-8', isAdmin: false })), /only deposits you recorded/);
  await runAsSystem(() => editDeposit('DEP-1', changes, { employeeId: 'DPE-8', isAdmin: true }));
  await assert.rejects(() => runAsSystem(() => editDeposit('DEP-2', changes, { employeeId: 'DPE-7', isAdmin: false })), /voided deposit cannot be edited/);
  await assert.rejects(() => runAsSystem(() => editDeposit('DEP-1', { ...changes, amount: 0 }, { employeeId: 'DPE-7', isAdmin: false })), /amount deposited/);
  // Remarks (owner, October 14, 2026): numbers, or letters and numbers; never letters only; required.
  await assert.rejects(() => runAsSystem(() => editDeposit('DEP-1', { ...changes, remarks: 'Already deposited' }, { employeeId: 'DPE-7', isAdmin: false })), /letters only are not accepted/);
  await assert.rejects(() => runAsSystem(() => editDeposit('DEP-1', { ...changes, remarks: '' }, { employeeId: 'DPE-7', isAdmin: false })), /Enter the remarks/);
  await runAsSystem(() => editDeposit('DEP-1', { ...changes, remarks: '01101026001363' }, { employeeId: 'DPE-7', isAdmin: false }));
});

test('Fidelity handed in after encoding: its own slip, in the report at once, approved like any slip', async () => {
  const h = harness();
  deadlineHeaders(h);
  const { createFidelitySlip, decideCashRemittance } = h.load('lib/remittance-workflow.ts');
  const { runAsSystem } = h.load('lib/encoder-context.ts');
  await runAsSystem(() => createFidelitySlip({ masEmployeeId: 'DPE-0002', masName: 'MAS-2', branch: 'MINTAL', amount: 30, date: '2026-10-13', remarks: 'For the Oct 12 collections' }));
  const values = h.writes.at(-1).requestBody.requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.deepEqual([values[1], values[2], values[3], values[4], values[10], values[11], values[13], values[15], values[24], values[25]],
    ['MINTAL', 'MAS-2', '2026-10-13', 'Pending Approval', 30, 30, 'DPE-0002', 0, 30, 'Fidelity'], 'a slip with no entries whose amount is the Fidelity');
  await assert.rejects(() => runAsSystem(() => createFidelitySlip({ masEmployeeId: 'DPE-0002', masName: 'MAS-2', branch: 'MINTAL', amount: 0, date: '2026-10-13' })), /Fidelity amount/);

  // The clerk's report: Fidelity slips the clerk recorded in the period and branch are cash in (Fidelity Bond).
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }, { employee_id: 'DPE-7', full_name: 'Clerk' }]);
  await seed('remittances', [
    { remittance_id: 'REM-F1', branch: 'MINTAL', mas: 'MAS-2', date_remitted: '2026-10-13', status: 'Pending Approval', remittance_type: 'Fidelity', fidelity_amount: 30, accountable_employee_id: 'DPE-0002', received_by_employee_id: 'DPE-7', encoded_by_employee_id: 'DPE-7', remarks: 'Late Fidelity' },
    { remittance_id: 'REM-F2', branch: 'MINTAL', mas: 'MAS-2', date_remitted: '2026-10-13', status: 'Voided', remittance_type: 'Fidelity', fidelity_amount: 99, accountable_employee_id: 'DPE-0002', received_by_employee_id: 'DPE-7', encoded_by_employee_id: 'DPE-7' },
    { remittance_id: 'REM-F3', branch: 'TORIL', mas: 'MAS-2', date_remitted: '2026-10-13', status: 'Pending Approval', remittance_type: 'Fidelity', fidelity_amount: 40, accountable_employee_id: 'DPE-0002', received_by_employee_id: 'DPE-7', encoded_by_employee_id: 'DPE-7' },
  ]);
  const { buildClerkReport } = h.load('lib/clerk-report.ts');
  const report = await buildClerkReport('daily', '2026-10-13', { employeeId: 'DPE-7', name: 'Clerk', branch: 'MINTAL' }, 'MINTAL');
  assert.deepEqual(report.fidelitySlips.map((item) => [item.id, item.amount]), [['REM-F1', 30]], 'not the voided one, not another branch');
  assert.equal(report.cash.fidelity, 30);
  assert.deepEqual(report.fidelityReceived.map((item) => [item.id, item.kind, item.amount]), [['REM-F1', 'slip', 30]]);
  assert.equal(report.fidelityReceived.reduce((sum, item) => sum + item.amount, 0), report.cash.fidelity, 'the Fidelity list adds up to the Fidelity Bond line');

  // Approving a Fidelity slip needs no entries.
  const remittancesHeader = Array(28).fill(''); remittancesHeader[12] = 'Difference'; remittancesHeader[26] = 'time_remitted'; remittancesHeader[27] = 'cash_count';
  const collectionsHeader = Array(39).fill(''); collectionsHeader[28] = 'Remittance Status'; collectionsHeader[38] = 'forfeited_incentive';
  h.rows.Collections = [collectionsHeader];
  h.rows.Remittances = [remittancesHeader, ['REM-F1', 'MINTAL', 'MAS-2', '2026-10-13', 'Pending Approval', '', 'U9', 'DPE-7', 'Clerk', '', 30, 30, 0, 'DPE-0002', 'MAS', 0, 'DPE-7', 'Clerk', '', '', '', '', 'Late Fidelity', '', 30, 'Fidelity', '', '']];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  await h.sync();
  const decided = await runAsSystem(() => decideCashRemittance('REM-F1', 'approve', '', true));
  assert.equal(decided.status, 'Approved');
});

test('on a grace day every incentive is kept, however late the cash (October 13, 2026)', () => {
  const h = harness();
  const { keepsIncentive } = h.load('lib/remittance-deadline.ts');
  const { forfeitsIncentive } = h.load('lib/remittance-workflow.ts');
  assert.equal(keepsIncentive('2026-10-08', '2026-10-12 16:00'), false, 'a normal day: after 3:00 PM the next working day it is late');
  assert.equal(keepsIncentive('2026-10-08', '2026-10-13 16:00'), true, 'received on the grace day: kept');
  assert.equal(keepsIncentive('2026-10-08', '2026-10-14 09:00'), false, 'the day after: late again');
  const item = { amount: 350, remittanceAmount: 200, orDate: '2026-10-08', incentiveDeadline: '2026-10-09 15:00' };
  assert.equal(forfeitsIncentive(item, '2026-10-13 16:00'), false);
  assert.equal(forfeitsIncentive(item, '2026-10-14 09:00'), true);
});

test('a clearing listed by mistake can be corrected until its entries are encoded', async () => {
  const h = harness();
  const today = h.load('lib/account-rules.ts').todayInManila();
  await seed('branches', [{ branch_id: 'BR-1', branch_name_code: 'BR-1', status: 'active' }, { branch_id: 'BR-2', branch_name_code: 'BR-2', status: 'active' }]);
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2', employment_status: 'Active' }, { employee_id: 'DPE-0003', full_name: 'MAS-3', employment_status: 'Active' }]);
  await seed('employee_branches', [{ assignment_id: 'EBA-1', employee_id: 'DPE-0002', branch_id: 'BR-1' }, { assignment_id: 'EBA-2', employee_id: 'DPE-0003', branch_id: 'BR-2' }]);
  await seedAccount({ doi: today, mas: 'MAS-3', branch: 'BR-2' });
  await seed('clearings', [{ clearing_id: 'CLR-E', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: `${today}T00:00:00+08:00`, cleared_date: today, status: 'Open', covers: 'New Sales' }]);
  const clearing = h.load('lib/clearing.ts');
  // Wrong branch, person and kind: corrected while nothing is encoded.
  await clearing.editClearing({ id: 'CLR-E', branch: 'BR-2', employeeId: 'DPE-0003', covers: 'Both' });
  const [row] = await query("select branch, employee_id, employee_name, covers from clearings where clearing_id = 'CLR-E'");
  assert.deepEqual(row, { branch: 'BR-2', employee_id: 'DPE-0003', employee_name: 'MAS-3', covers: 'Both' });
  await assert.rejects(() => clearing.editClearing({ id: 'CLR-E', branch: 'BR-1', employeeId: 'DPE-0003', covers: 'Both' }), /not assigned to BR-1/);
  // Once a collection is encoded on it: Collections stays ticked, and the branch and person stay.
  await seed('collections', [{ collection_id: 'COL-E', collection_batch_id: 'CBT-E', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-2', or_number: '6001 C', amount_collected: 350, status: 'Posted', remittance_status: 'Outstanding', accountable_employee_id: 'DPE-0003', date_remitted: today, encoded_at: new Date().toISOString(), remittance_method: 'Cash' }]);
  await assert.rejects(() => clearing.editClearing({ id: 'CLR-E', branch: 'BR-2', employeeId: 'DPE-0003', covers: 'New Sales' }), /Collections are already encoded/);
  await assert.rejects(() => clearing.editClearing({ id: 'CLR-E', branch: 'BR-1', employeeId: 'DPE-0002', covers: 'Both' }), /only before anything is encoded/);
  await clearing.editClearing({ id: 'CLR-E', branch: 'BR-2', employeeId: 'DPE-0003', covers: 'Collections' });
  assert.equal((await query("select covers from clearings where clearing_id = 'CLR-E'"))[0].covers, 'Collections', 'New Sales (none encoded) can be unticked');
  await assert.rejects(() => clearing.editClearing({ id: 'CLR-E', branch: 'BR-2', employeeId: 'DPE-0003', covers: 'Both' }, 'DPE-9999'), /Only a clearing you made/);
});

test('an expense goes on the report of the day it was recorded, whatever expense date was typed (October 14, 2026)', async () => {
  const h = harness();
  const expense = Array(21).fill(''); Object.assign(expense, { 0: 'EXP-9', 1: '2026-10-10', 2: 'Fare', 4: 75, 7: 'MINTAL', 11: 'Posted', 18: 'DPE-7', 20: '2026-10-14T01:30:00.000Z' });
  h.rows.Expenses = [[], expense];
  await h.sync();
  const { buildClerkReport } = h.load('lib/clerk-report.ts');
  const clerk = { employeeId: 'DPE-7', name: 'Clerk', branch: 'MINTAL' };
  const recorded = await buildClerkReport('daily', '2026-10-14', clerk, 'MINTAL');
  assert.deepEqual(recorded.expenses.map((item) => [item.id, item.date, item.amount]), [['EXP-9', '2026-10-10', 75]], 'on the day recorded, showing the expense date typed');
  assert.equal(recorded.cash.expenses, 75);
  assert.equal((await buildClerkReport('daily', '2026-10-10', clerk, 'MINTAL')).expenses.length, 0, 'not on the expense date');
});

test('an expense on the report can be edited and deleted by the clerk who recorded it, not by another clerk', async () => {
  const h = harness({ userId: 'USR-7', employeeId: 'DPE-7', name: 'Clerk', roleNames: ['Entry Clerk'], permissions: {} });
  const expense = Array(23).fill(''); Object.assign(expense, { 0: 'EXP-9', 1: '2026-10-10', 2: 'Transportation', 3: 'Fare', 4: 75, 7: 'MINTAL', 11: 'Posted', 18: 'DPE-7', 20: '2026-10-14T01:30:00.000Z', 22: 'VP Finance' });
  h.rows.Expenses = [['expense_id'], expense];
  h.rows['Cash Transactions'] = [['transaction_id']];
  await h.sync();
  const finance = h.load('lib/finance-data.ts');
  const { withEncoder } = h.load('lib/encoder-context.ts');
  // Saving needs a verified encoder (the signed-in user), as the clerk-report route provides.
  const as = (work) => withEncoder(async () => { await work(); return Response.json({}); })(request());
  const editExpense = (...args) => as(() => finance.editExpense(...args));
  const deleteExpense = (...args) => as(() => finance.deleteExpense(...args));
  const own = { employeeId: 'DPE-7', isAdmin: false };
  await assert.rejects(editExpense('EXP-9', { date: '2026-10-11', category: 'Others', categoryOther: '', amount: 80, description: 'Fare', approvedBy: 'VP Finance' }, own), /Specify the other account name/);
  await assert.rejects(editExpense('EXP-9', { date: '2026-10-11', category: 'Office Supplies', amount: 80, description: 'Lunch', receiptNumber: 'R-1', approvedBy: 'VP Finance' }, { employeeId: 'DPE-8', isAdmin: false }), /only expenses you recorded/);
  // October 20, 2026: a receipt number on every expense, and the member's name for Cash Burial Assistance.
  await assert.rejects(editExpense('EXP-9', { date: '2026-10-11', category: 'Office Supplies', amount: 80, description: 'Lunch', approvedBy: 'VP Finance' }, own), /receipt number/);
  await assert.rejects(editExpense('EXP-9', { date: '2026-10-11', category: 'CBA (Cash Burial Assistance)', amount: 80, description: 'Burial', receiptNumber: 'R-1', approvedBy: 'VP Finance' }, own), /deceased member/);
  await editExpense('EXP-9', { date: '2026-10-11', category: 'CBA (Cash Burial Assistance)', amount: 80, description: 'Burial', receiptNumber: 'R-1', payee: 'Juan Cruz', approvedBy: 'VP Finance' }, own);
  assert.deepEqual(h.writes.at(-1).requestBody.data.find((item) => item.range === "'Expenses'!F2").values[0], ['Juan Cruz'], 'the member is saved as the payee');
  await editExpense('EXP-9', { date: '2026-10-11', category: 'Office Supplies', amount: 80, description: 'Lunch', receiptNumber: 'R-1', remarks: 'team', approvedBy: 'Other', approvedByOther: 'Branch head' }, own);
  // Row 2 of Expenses: B:E date, account, purpose, amount; K receipt; M remarks; W approver.
  const edit = h.writes.at(-1).requestBody.data;
  assert.deepEqual(edit.map((item) => [item.range, item.values[0]]), [
    ["'Expenses'!B2:E2", ['2026-10-11', 'Office Supplies', 'Lunch', 80]], ["'Expenses'!K2", ['R-1']], ["'Expenses'!M2", ['team']], ["'Expenses'!W2", ['Other: Branch head']],
  ]);
  await assert.rejects(deleteExpense('EXP-9', 'x', own), /reason/);
  await deleteExpense('EXP-9', 'entered twice', own);
  const removed = h.writes.at(-1).requestBody.data;
  assert.deepEqual([removed[0].range, removed[0].values[0][0], removed[1].values[0][2]], ["'Expenses'!L2", 'Voided', 'entered twice'], 'deleted: voided with the reason');
  // A voided expense cannot be changed again.
  expense[11] = 'Voided';
  await assert.rejects(deleteExpense('EXP-9', 'again please', own), /already deleted/);
});

test('Edit / Corrections: a collection moves to the other program of the member, both accounts renumbered and its slip follows', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-0009', name: 'admin', roleNames: ['Administrator'], permissions: { manageUsers: true } });
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  await seed('members', [{ member_id: 'MEM-1', member_number: 'PH-1', surname: 'Santos', first_name: 'Ana' }]);
  await seed('programs', [{ program_id: 'DP-A', program_name: 'D-350', base_pay: 350 }, { program_id: 'DP-B', program_name: 'DPB-350', base_pay: 350 }]);
  await seed('program_incentives', [{ incentive_id: 'I-DP-A', program_id: 'DP-A', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }, { incentive_id: 'I-DP-B', program_id: 'DP-B', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  await seed('member_programs', [
    { enrollment_id: 'ENR-A', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-A', doi: '2026-01-01', branch: 'BR-1', mas: 'MAS-2', status: 'Active' },
    { enrollment_id: 'ENR-B', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-B', doi: '2026-01-01', branch: 'BR-1', mas: 'MAS-2', status: 'Active' },
  ]);
  const pay = (id, enrollment, program, or, date, nop, extra = {}) => ({ collection_id: id, collection_batch_id: `B-${id}`, enrollment_id: enrollment, member_id: 'MEM-1', member_number: 'PH-1', program_id: program, branch: 'BR-1', mas: 'MAS-2', or_number: or, or_date: date, amount_collected: 350, month_from: `2026-0${nop}`, month_to: `2026-0${nop}`, nop_from: nop, nop_to: nop, status: 'Posted', collected_by_role: 'MAS', remittance_amount: 175, ...extra });
  await seed('remittances', [{ remittance_id: 'REM-1', branch: 'BR-1', mas: 'MAS-2', status: 'Approved', gross_collection: 175, total_remittance: 175, difference: 0 }]);
  await seed('collections', [
    pay('C1', 'ENR-A', 'DP-A', '101 C', '2026-02-05', 2),
    pay('C2', 'ENR-A', 'DP-A', '102 C', '2026-03-05', 3, { remittance_status: 'Remitted', linked_remittance_id: 'REM-1' }),
    pay('C3', 'ENR-B', 'DP-B', '103 C', '2026-02-06', 2),
  ]);
  await seed('remittance_collections', [{ remittance_collection_id: 'RC-1', remittance_id: 'REM-1', collection_id: 'C2', amount: 175 }]);
  const route = h.load('app/api/entry-corrections/route.ts');

  const loaded = await (await route.GET(new Request('http://localhost/api/entry-corrections?kind=Collection&id=C2'))).json();
  assert.equal(loaded.success, true, JSON.stringify(loaded));
  assert.deepEqual(loaded.entry.accounts.map((account) => account.enrollmentId).sort(), ['ENR-A', 'ENR-B']);
  assert.equal(loaded.entry.remittance.onSlip, true);

  assert.match((await (await route.PUT(request({ kind: 'Collection', id: 'C2', enrollmentId: 'ENR-B' }))).json()).message, /reason/);
  const saved = await (await route.PUT(request({ kind: 'Collection', id: 'C2', enrollmentId: 'ENR-B', reason: 'Receipt is DPB-350' }))).json();
  assert.equal(saved.success, true, JSON.stringify(saved));
  const rows = await query('select collection_id, enrollment_id, program_id, nop_from, month_from from collections order by collection_id');
  assert.deepEqual(rows.map((row) => [row.collection_id, row.enrollment_id, row.program_id, row.nop_from, row.month_from]), [
    ['C1', 'ENR-A', 'DP-A', 2, '2026-02'], ['C2', 'ENR-B', 'DP-B', 3, '2026-03'], ['C3', 'ENR-B', 'DP-B', 2, '2026-02'],
  ]);
  // The company share at NOP 3 of DPB-350 is 200 (it was remitted as 175): the slip expects 25 more than the cash received.
  const [slip] = await query('select gross_collection::float8 as expected, difference::float8 as difference from remittances');
  assert.deepEqual(slip, { expected: 200, difference: -25 });
  assert.equal((await query('select amount::float8 as amount from remittance_collections'))[0].amount, 200);

  // Fixing only the OR number keeps the share it was remitted with.
  await query("update collections set remittance_amount = 123 where collection_id = 'C2'");
  assert.match((await (await route.PUT(request({ kind: 'Collection', id: 'C2', orNumber: '1020 C', reason: 'typo' }))).json()).message, /saved: or number\.$/);
  assert.deepEqual(await query('select gross_collection::float8 as expected from remittances'), [{ expected: 200 }], 'the slip is untouched');
  assert.deepEqual(await query("select or_number, remittance_amount::float8 as share from collections where collection_id = 'C2'"), [{ or_number: '1020 C', share: 123 }]);

  // A later OR date for the only payment of an account: it stays NOP 2.
  const later = await (await route.PUT(request({ kind: 'Collection', id: 'C1', orDate: '2026-04-10', reason: 'date typo' }))).json();
  assert.equal(later.success, true, JSON.stringify(later));
  assert.equal((await query("select nop_from from collections where collection_id = 'C1'"))[0].nop_from, 2);

  // Two months on C3 would overlap C2's month on ENR-B: renumbered C3 NOP 2-3, C2 NOP 4. Amount 350 cannot pay two months: refused.
  assert.match((await (await route.PUT(request({ kind: 'Collection', id: 'C3', months: 2, reason: 'two months' }))).json()).message, /Nothing was saved/);
  assert.equal((await query("select nop_to from collections where collection_id = 'C3'"))[0].nop_to, 2);

  // An Entry Clerk may not edit.
  h.setUser({ userId: 'USR-3', employeeId: 'DPE-0003', name: 'clerk', roleNames: ['Entry Clerk'], permissions: {} });
  assert.equal((await route.PUT(request({ kind: 'Collection', id: 'C2', reason: 'x y z' }))).status, 403);
});

test('Edit / Corrections: a New Sale changes program with its account, merged when the member already has that program', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-0009', name: 'it', roleNames: ['IT Clerk'], permissions: {} });
  h.rows.Branches = [[], ['BR-1', 'BR-1', '', '', '', '', '', '', '', '', '', '', 'active']];
  await seed('members', [{ member_id: 'MEM-2', member_number: 'PH-2', surname: 'Cruz', first_name: 'Rina' }]);
  await seed('programs', [{ program_id: 'DP-A', program_name: 'D-350', base_pay: 350 }, { program_id: 'DP-C', program_name: 'DC-350', base_pay: 350 }, { program_id: 'DP-D', program_name: 'D-500', base_pay: 500 }]);
  await seed('program_incentives', [{ incentive_id: 'I-DP-A', program_id: 'DP-A', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }, { incentive_id: 'I-DP-C', program_id: 'DP-C', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }, { incentive_id: 'I-DP-D', program_id: 'DP-D', role: 'MAS', from_month: 1, to_month: 999, incentive_type: 'percentage', mark_up: 50, incentive_amount: 50 }]);
  await seed('member_programs', [{ enrollment_id: 'ENR-S', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-A', doi: '2026-10-01', branch: 'BR-1', mas: 'MAS-2', status: 'Active' }]);
  await seed('sales', [{ sale_id: 'S1', member_number: 'PH-2', surname: 'Cruz', first_name: 'Rina', program_id: 'DP-A', branch: 'BR-1', mas: 'MAS-2', amount_paid: 350, application_no: 'APP-1', or_date: '2026-10-01', doi: '2026-10-01', remittance_status: 'Outstanding' }]);
  // A collection on the account, with a company share that does not match the program's tiers (as if priced by another program).
  await seed('collections', [{ collection_id: 'C9', collection_batch_id: 'B9', enrollment_id: 'ENR-S', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-A', branch: 'BR-1', mas: 'MAS-2', or_number: '901 C', or_date: '2026-10-02', amount_collected: 350, month_from: '2026-11', month_to: '2026-11', nop_from: 2, nop_to: 2, status: 'Posted', collected_by_role: 'MAS', remittance_amount: 1 }]);
  const route = h.load('app/api/entry-corrections/route.ts');

  // A 500 program needs 500: refused until the amount is right too.
  assert.match((await (await route.PUT(request({ kind: 'New Sale', id: 'S1', programId: 'DP-D', reason: 'wrong program' }))).json()).message, /fixed New Sale amount of 500/);
  const saved = await (await route.PUT(request({ kind: 'New Sale', id: 'S1', programId: 'DP-C', applicationNumber: 'APP-1B', reason: 'Clerk chose D-350' }))).json();
  assert.equal(saved.success, true, JSON.stringify(saved));
  assert.deepEqual(await query('select program_id, application_no from sales'), [{ program_id: 'DP-C', application_no: 'APP-1B' }]);
  // The DOI time (October 19, 2026): edited on the sale and its account; not a time is refused.
  assert.equal((await (await route.GET(new Request('http://localhost/api/entry-corrections?kind=New+Sale&id=S1'))).json()).entry.values.doiTime, '', 'a sale saved before has no time');
  assert.match((await (await route.PUT(request({ kind: 'New Sale', id: 'S1', doiTime: '9am', reason: 'time' }))).json()).message, /DOI time as hours and minutes/);
  const timed = await (await route.PUT(request({ kind: 'New Sale', id: 'S1', doiTime: '09:40', reason: 'Enrolled in the morning' }))).json();
  assert.match(timed.message, /DOI time 09:40/);
  assert.deepEqual([(await query('select doi_time from sales'))[0].doi_time, (await query('select doi_time from member_programs'))[0].doi_time], ['09:40:00', '09:40:00']);
  assert.deepEqual(await query('select enrollment_id, program_id from member_programs'), [{ enrollment_id: 'ENR-S', program_id: 'DP-C' }]);
  // Its collections moved to the new program and took that program's incentive: reports follow.
  assert.deepEqual(await query('select program_id, remittance_amount::float8 as share from collections'), [{ program_id: 'DP-C', share: 200 }]);
  assert.match(saved.message, /1 collection\(s\) with new incentives/);

  await seed('member_programs', [{ enrollment_id: 'ENR-T', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-A', doi: '2026-09-01', branch: 'BR-1', mas: 'MAS-2', status: 'Active' }]);
  // The member already has a D-350 account with a payment: the New Sale's account merges into it (owner, October 16, 2026).
  await seed('collections', [{ collection_id: 'C8', collection_batch_id: 'B8', enrollment_id: 'ENR-T', member_id: 'MEM-2', member_number: 'PH-2', program_id: 'DP-A', branch: 'BR-1', mas: 'MAS-2', or_number: '801 C', or_date: '2026-09-05', amount_collected: 350, month_from: '2026-10', month_to: '2026-10', nop_from: 2, nop_to: 2, status: 'Posted', collected_by_role: 'MAS', remittance_amount: 200 }]);
  const merged = await (await route.PUT(request({ kind: 'New Sale', id: 'S1', programId: 'DP-A', reason: 'back again' }))).json();
  assert.equal(merged.success, true, JSON.stringify(merged));
  assert.match(merged.message, /merged into the member's D-350 account ENR-T/);
  assert.deepEqual(await query('select enrollment_id, program_id, doi::text as doi from member_programs'), [{ enrollment_id: 'ENR-T', program_id: 'DP-A', doi: '2026-09-01' }]);
  assert.deepEqual(await query('select collection_id, enrollment_id, program_id, nop_from, month_from from collections order by nop_from'), [
    { collection_id: 'C8', enrollment_id: 'ENR-T', program_id: 'DP-A', nop_from: 2, month_from: '2026-10' },
    { collection_id: 'C9', enrollment_id: 'ENR-T', program_id: 'DP-A', nop_from: 3, month_from: '2026-11' },
  ], 'numbered in OR-date order');
  assert.equal((await query('select program_id from sales'))[0].program_id, 'DP-A');
});

test('an employee marked Day Off cannot encode, change or delete entries that day; earlier entries stay and are noted', async () => {
  const h = harness();
  const { getPhilippineDate } = h.load('lib/attendance.ts');
  const today = getPhilippineDate();
  await seed('employees', [{ employee_id: 'DPE-0001', full_name: 'Clerk' }]);
  await seed('programs', [{ program_id: 'DP-1', program_name: 'P', base_pay: 350 }]);
  await seed('sales', [{ sale_id: 'S-EARLY', member_number: 'PH-1', program_id: 'DP-1', amount_paid: 350, application_no: 'A-1', encoded_by_employee_id: 'DPE-0001', encoded_at: new Date().toISOString() }]);
  const { dayOffEntriesNote, isOnDayOff } = h.load('lib/day-off.ts');
  assert.equal(await isOnDayOff('DPE-0001'), false);
  assert.match(await dayOffEntriesNote('DPE-0001', today), /1 New Sale encoded that day before this mark; kept for review/);
  await seed('attendance', [{ attendance_id: 'ATT-1', employee_id: 'DPE-0001', attendance_date: today, attendance_status: 'Day Off', notes: 'Day Off marked by HR' }]);
  assert.equal(await isOnDayOff('DPE-0001'), true);
  for (const [route, method] of [['app/api/collections/route.ts', 'POST'], ['app/api/sales/route.ts', 'POST'], ['app/api/admin-delete/route.ts', 'POST'], ['app/api/clerk-report/route.ts', 'POST'], ['app/api/my-entries/batch/route.ts', 'POST']]) {
    const response = await h.load(route)[method](request({}));
    assert.equal(response.status, 403, route);
    assert.match((await response.json()).message, /marked Day Off today/, route);
  }
  assert.equal(await count('sales'), 1, 'the entry encoded before the mark stays');
});

test('Fidelity history: a rejected slip shows as Returned and names the clerk who encoded it, not System', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-0009', name: 'finance', roleNames: ['Finance'], permissions: {} });
  h.rows.Employees = [[], ['DPE-0002', 'MAS Two', 'BR-1', 'MAS', 'active']];
  const slip = (id, status, receivedBy = '') => { const row = Array(25).fill(''); Object.assign(row, { 0: id, 1: 'BR-1', 2: 'MAS Two', 3: '2026-10-10', 4: status, 8: 'System', 13: 'DPE-0002', 17: receivedBy, 24: 100 }); return row; };
  h.rows.Remittances = [['remittance_id'], slip('REM-1', 'Rejected'), slip('REM-2', 'Approved'), slip('REM-3', 'Pending Approval', 'Clerk Bee')];
  h.rows.Fidelity = [['claim_id']];
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS Two' }]);
  await seed('programs', [{ program_id: 'DP-1', program_name: 'P', base_pay: 100 }]);
  await seed('members', [{ member_id: 'M1', member_number: 'PH-1', surname: 'S', first_name: 'A' }]);
  await seed('member_programs', [{ enrollment_id: 'E1', member_id: 'M1', member_number: 'PH-1', program_id: 'DP-1', doi: '2026-09-01', status: 'Active' }]);
  await seed('remittances', [{ remittance_id: 'REM-1', status: 'Rejected' }, { remittance_id: 'REM-2', status: 'Approved' }]);
  await seed('collections', [
    { collection_id: 'C1', collection_batch_id: 'B1', enrollment_id: 'E1', member_id: 'M1', program_id: 'DP-1', or_number: '1 C', or_date: '2026-10-09', amount_collected: 100, status: 'Posted', encoded_by_name: 'Clerk Ann' },
    { collection_id: 'C2', collection_batch_id: 'B1', enrollment_id: 'E1', member_id: 'M1', program_id: 'DP-1', or_number: '2 C', or_date: '2026-10-10', amount_collected: 100, status: 'Posted', encoded_by_name: 'Clerk Ann' },
  ]);
  await seed('remittance_collections', [
    { remittance_collection_id: 'RC-1', remittance_id: 'REM-1', collection_id: 'C1', amount: 50 },
    { remittance_collection_id: 'RC-2', remittance_id: 'REM-2', collection_id: 'C2', amount: 50 },
  ]);
  await h.sync();
  const { getFidelityData } = h.load('lib/fidelity.ts');
  const data = await getFidelityData('', true);
  const shown = Object.fromEntries(data.transactions.map((item) => [item.id, [item.status, item.encodedBy]]));
  assert.deepEqual(shown, { 'REM-1': ['Returned', 'Clerk Ann'], 'REM-2': ['Approved', 'Clerk Ann'], 'REM-3': ['Pending Approval', 'Clerk Bee'] });
  const account = data.accounts.find((item) => item.masEmployeeId === 'DPE-0002');
  assert.deepEqual([account.approved, account.pending], [100, 100], 'a returned slip still does not count');
});

test('Fidelity opening balances from the old system count in; an old withdrawal counts out (October 23, 2026)', async () => {
  const h = harness({ userId: 'USR-9', employeeId: 'DPE-0009', name: 'finance', roleNames: ['Finance'], permissions: {} });
  h.rows.Employees = [[], ['DPE-0002', 'MAS Two', 'BR-1', 'MAS', 'active']];
  const slip = Array(25).fill(''); Object.assign(slip, { 0: 'REM-1', 1: 'BR-1', 2: 'MAS Two', 3: '2026-10-10', 4: 'Approved', 8: 'System', 13: 'DPE-0002', 24: 100 });
  h.rows.Remittances = [['remittance_id'], slip];
  h.rows.Fidelity = [['claim_id'],
    ['FOB-1', 'DPE-0002', 'MAS Two', '', '', 'Opening Balance (old system)', 0, 16782.6, '2026-09-30', 'Approved', 'sheet row 4'],
    ['FOW-1', 'DPE-0002', 'MAS Two', '', '', 'Withdrawal (old system)', 0, 4378.4, '2026-09-30', 'Released', '50%'],
  ];
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS Two' }]);
  await h.sync();
  const { getFidelityData } = h.load('lib/fidelity.ts');
  const data = await getFidelityData('', true);
  assert.deepEqual(data.transactions.map((item) => [item.id, item.direction]).sort(), [['FOB-1', 'in'], ['FOW-1', 'out'], ['REM-1', 'in']]);
  const account = data.accounts.find((item) => item.masEmployeeId === 'DPE-0002');
  assert.deepEqual([account.approved, account.claimed, account.locked, account.withdrawable], [12504.2, 4378.4, 10000, 2504.2], 'total minus the old withdrawal, plus the new contribution');
});

test('a resubmitted batch keeps the time its cash was cleared, even when the MAS was cleared again later', async () => {
  const h = harness();
  await seedAccount({ doi: '2026-09-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  // Cleared at 10:00 on the 13th (linked to the first slip), and again at 16:30 the same day for another handover.
  await seed('remittances', [{ remittance_id: 'REM-OLD', branch: 'BR-1', mas: 'MAS-2', status: 'Rejected', date_remitted: '2026-10-13', time_remitted: '10:00' }]);
  await seed('clearings', [
    { clearing_id: 'CLR-1', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: '2026-10-13T02:00:00Z', cleared_date: '2026-10-13', status: 'Encoded', covers: 'Both', remittance_id: 'REM-OLD' },
    { clearing_id: 'CLR-2', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: '2026-10-13T08:30:00Z', cleared_date: '2026-10-13', status: 'Open', covers: 'Both' },
  ]);
  await seed('collections', [{ collection_id: 'R1', collection_batch_id: 'CBT-R', enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: 'R1 C', amount_collected: 350, status: 'Posted', remittance_status: 'Outstanding', accountable_employee_id: 'DPE-0002', date_remitted: '2026-10-13', encoded_at: '2026-10-13T09:00:00Z', remittance_method: 'Cash' }]);
  await seed('remittance_collections', [{ remittance_collection_id: 'RC-R', remittance_id: 'REM-OLD', collection_id: 'R1', amount: 175 }]);
  const { receivedAtOf } = h.load('lib/remittance-workflow.ts');
  const item = { id: 'R1', encodedAt: '2026-10-13 17:00', dateRemitted: '2026-10-13', accountableEmployeeId: 'DPE-0002', branch: 'BR-1', kind: 'Collections' };
  assert.deepEqual(await receivedAtOf([item]), { date: '2026-10-13', time: '10:00' }, 'the clearing linked to its first slip, not the 16:30 one');
  // OR dated the 12th: due 3:00 PM on the 13th, so the incentive is kept.
  assert.equal(h.load('lib/remittance-deadline.ts').keepsIncentive('2026-10-12', '2026-10-13 10:00'), true);
  // Without the link, the returned slip's own time still caps it.
  await pglite.query("update clearings set remittance_id = null where clearing_id = 'CLR-1'");
  assert.deepEqual(await receivedAtOf([item]), { date: '2026-10-13', time: '10:00' }, 'never later than the returned slip');
});

test('no second batch for the same person and day while one is waiting for approval, unless cleared again', async () => {
  const h = harness();
  await seedAccount({ doi: '2026-09-01' });
  await seed('employees', [{ employee_id: 'DPE-0002', full_name: 'MAS-2' }]);
  await seed('clearings', [{ clearing_id: 'CLR-1', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: '2026-10-15T02:00:00Z', cleared_date: '2026-10-15', status: 'Encoded', covers: 'Both' }]);
  const col = (id, extra = {}) => ({ collection_id: id, collection_batch_id: `CBT-${id}`, enrollment_id: 'ENR-1', member_id: 'MEM-1', member_number: 'PH-1', program_id: 'DP-1', branch: 'BR-1', or_number: `${id} C`, amount_collected: 350, status: 'Posted', remittance_status: 'Pending Remittance Approval', accountable_employee_id: 'DPE-0002', date_remitted: '2026-10-15', encoded_at: '2026-10-15T03:00:00Z', encoded_by_employee_id: 'DPE-0001', encoded_by_name: 'Clerk One', remittance_method: 'Cash', collected_by_role: 'MAS', ...extra });
  await seed('collections', [col('W1')]);
  const { waitingBatchProblem } = h.load('lib/clearing.ts');
  globalThis.dayongClearingNotRequired = false;
  try {
    const refused = await waitingBatchProblem('DPE-0002', 'MAS-2', 'br-1', '2026-10-15', 'Collections');
    assert.match(refused, /MAS-2 already has a Collections batch for br-1 on 2026-10-15 that is waiting for approval \(1 entry, .*350.*encoded by Clerk One at 11:00\)/);
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'New Sales'), '', 'New Sales are a separate batch');
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-14', 'Collections'), '', 'another day');
    // Returned: fix it in My Entries.
    await pglite.query("update collections set remittance_status = 'Returned'");
    assert.match(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'Collections'), /Edit batch/);
    // Approved (Remitted): the next batch is fine.
    await pglite.query("update collections set remittance_status = 'Remitted'");
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'Collections'), '');
    // Waiting again, but the MAS was cleared again after it was encoded: another handover.
    await pglite.query("update collections set remittance_status = 'Outstanding'");
    await seed('clearings', [{ clearing_id: 'CLR-2', branch: 'BR-1', employee_id: 'DPE-0002', employee_name: 'MAS-2', cleared_at: '2026-10-15T06:00:00Z', cleared_date: '2026-10-15', status: 'Open', covers: 'Collections' }]);
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'Collections'), '', 'cleared again after the waiting batch');
    // DTO batches and imported entries (no encoder) never block.
    await pglite.query("delete from clearings where clearing_id = 'CLR-2'");
    await pglite.query("update collections set collected_by_role = 'DTO'");
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'Collections'), '');
    await pglite.query("update collections set collected_by_role = 'MAS', encoded_by_employee_id = null");
    assert.equal(await waitingBatchProblem('DPE-0002', 'MAS-2', 'BR-1', '2026-10-15', 'Collections'), '');
  } finally { globalThis.dayongClearingNotRequired = true; }
});

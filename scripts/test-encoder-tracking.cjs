/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Execute the actual TS routes/data helpers with an in-memory Sheets transport.
// No credentials, network calls, or production rows are used by these tests.
function harness(user = { userId: 'USR-1', employeeId: 'DPE-0001', username: '=encoder', permissions: {} }) {
  const cache = new Map();
  const writes = [];
  const rows = {};
  let missingHeaders = false;
  const titles = ['Member programs', 'Members', 'Programs', 'Collections', 'Remittances', 'Remittance Collections', 'Sales'];
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
      if (/^'?Roles'?!A:G$/.test(range)) return { data: { values: rows.Roles ?? [[]] } };
      if (/^'?Users'?!A:(?:B|G|H)$/.test(range)) return { data: { values: rows.Users ?? [[]] } };
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
      if (name === '@/lib/auth-server') return {
        getSessionUser: async () => user,
        canManageUsers: async () => Boolean(user?.permissions.manageUsers),
        canManageAttendance: async () => Boolean(user?.permissions.manageAttendance),
      };
      if (name === '@/lib/google-sheets') return { sheets, GOOGLE_SHEET_ID: 'test' };
      if (name === 'next/server') return { NextResponse: Response };
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      if (name.startsWith('./')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts');
      return require(name);
    };
    new Function('require', 'module', 'exports', source)(localRequire, loadedModule, loadedModule.exports);
    return loadedModule.exports;
  }
  return { load, rows, writes, setUser: (value) => { user = value; }, missingHeaders: () => { missingHeaders = true; } };
}

function request(body = {}) {
  return new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

test('employee registration is independent of login and records its encoder', async () => {
  const h = harness(null);
  const route = h.load('app/api/employees/route.ts');
  assert.equal((await route.GET()).status, 401);
  assert.equal((await route.POST(request({}))).status, 401);
  h.setUser({ userId: 'U1', employeeId: 'DPE-0001', username: 'admin', permissions: {} });
  assert.equal((await route.POST(request({}))).status, 403);
  h.setUser({ userId: 'U1', employeeId: 'DPE-0001', username: 'admin', permissions: { manageUsers: true } });
  h.rows.Employees = [[], ['DPE-0002', 'Ana', 'North', 'MAS', 'active']];
  h.rows.Users = [[], ['U1', 'DPE-0005']];
  h.rows.Branches = [[], ['BR-1', 'South', 'DDO 1', '', '', '', '', '', '', '', '', '', 'active']];
  h.rows.Roles = [[], ['R1', 'MAS', '', '', '', '', 'active']];
  const response = await route.POST(request({ name: '=Staff', branchIds: ['BR-1'], roles: ['Collector', 'MAS'], dateHired: '2026-09-25', encodedBy: 'spoof' }));
  assert.equal(response.status, 201);
  assert.equal((await response.json()).employee.id, 'DPE-0006');
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[0].range, "'Employees'!A:M");
  const row = h.writes[0].requestBody.values[0];
  assert.equal(row[1], "'=Staff");
  assert.equal(row[9], "'U1");
  assert.equal((await route.POST(request({ name: 'Bad', branchIds: ['BR-X'], roles: ['Invented'] }))).status, 400);
  const data = await (await route.GET()).json();
  assert.equal(data.employees[0].name, 'Ana');
  assert.equal('passwordHash' in data.employees[0], false);
});

test('employee status updates and deletion protect linked login accounts', async () => {
  const h = harness({ userId: 'U1', employeeId: 'DPE-0001', username: 'admin', permissions: { manageUsers: true } });
  const route = h.load('app/api/employees/route.ts');
  h.rows.Employees = [[], ['DPE-0002', 'Ana', 'North', 'MAS, Collector', 'active']];
  h.rows.Users = [[]];
  let response = await route.PATCH(request({ employeeId: 'DPE-0002', status: 'resigned' }));
  assert.equal(response.status, 200);
  assert.equal(h.writes.at(-1).range, "'Employees'!E2");
  response = await route.DELETE(request({ employeeId: 'DPE-0002' }));
  assert.equal(response.status, 200);
  assert.equal(h.writes.at(-1).range, "'Employees'!A2:M2");
  h.rows.Users = [[], ['USR-2', 'DPE-0002']];
  response = await route.DELETE(request({ employeeId: 'DPE-0002' }));
  assert.equal(response.status, 400);
});

test('member directory requires login, joins accounts once, and filters the same enrollment', async () => {
  const h = harness(null);
  const route = h.load('app/api/members/directory/route.ts');
  assert.equal((await route.GET()).status, 401);
  h.setUser({ userId: 'U1' });
  const member = ['M1', 'PH-001', 'Santos', 'Ana'];
  member[12] = '12'; member[16] = 'City'; member[17] = 'Province'; member[21] = 'TRUE'; member[29] = 'Active';
  h.rows.Members = [[], member, ['M2', 'PH-002', 'Cruz', 'Ben']];
  h.rows['Member programs'] = [[], ['E1', 'M1', 'PH-001', 'P1', '2026-01-01', 'North', 'MAS1'], ['E2', 'M1', 'PH-001', 'P2', '2026-02-01', 'South', 'MAS2']];
  h.rows.Programs = [[], ['P1', 'A', 'Program A'], ['P2', 'B', 'Program B']];
  const response = await route.GET();
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const { members } = await response.json();
  assert.equal(members.length, 2);
  const ana = members.find((m) => m.id === 'M1');
  assert.equal(ana.enrollments.length, 2);
  assert.equal(ana.claimantAddress, ana.address);
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
  assert.throws(() => buildMemberDirectory([member, member], [], []), /Duplicate member ID/);
  assert.equal(h.writes.length, 0);
});

test('all mutation routes reject unauthenticated requests before writing', async () => {
  const h = harness(null);
  for (const route of ['sales', 'collections', 'remittances', 'branches', 'programs', 'program-incentives', 'user-accounts', 'attendance', 'attendance-reviews', 'leave-requests', 'leave-approvals']) {
    assert.equal((await h.load(`app/api/${route}/route.ts`).POST(request())).status, 401, route);
  }
  assert.equal(h.writes.length, 0);
});

for (const existingMember of [false, true]) {
  test(`sales track every related row (${existingMember ? 'existing' : 'new'} member), ignore spoofed identity`, async () => {
    const h = harness();
    if (existingMember) h.rows.Members = [[], ['MEM-1', 'PH-1']];
    const response = await h.load('app/api/sales/route.ts').POST(request({
      branch: 'BR-1', mas: 'different-mas', dateRemitted: '2026-09-25',
      encodedBy: 'attacker', userId: 'attacker',
      sales: [{ existingMember, memberNumber: existingMember ? 'PH-1' : '', programId: 'DP-1', applicationNo: 'APP-1', addressBarangay: 'B', addressCity: 'C', addressProvince: 'P', encodedBy: 'attacker' }],
    }));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(h.writes.length, existingMember ? 2 : 3);
    const audit = h.writes.map((write) => write.requestBody.values[0].slice(write.range.startsWith("\'Member programs\'") ? -5 : -4, write.range.startsWith("\'Member programs\'") ? -1 : undefined));
    for (const values of audit) {
      assert.deepEqual(values.slice(0, 3), ["'USR-1", "'DPE-0001", "'=encoder"]);
      assert.equal(values[3], audit[0][3]);
      assert.ok(!Number.isNaN(Date.parse(values[3])));
    }
    assert.ok(!existingMember || h.writes.every((write) => !write.range.startsWith("'Members'!")));
  });
}

test('collection batch is encoded atomically without creating a remittance', async () => {
  const h = harness();
  const today = h.load('lib/account-rules.ts').todayInManila();
  const month = today.slice(0, 7);
  const next = h.load('lib/account-rules.ts').monthName(h.load('lib/account-rules.ts').monthIndex(month) + 1);
  h.rows.Members = [[], ['MEM-1', 'PH-1']];
  h.rows.Employees = [[], ['DPE-0002', 'MAS-2', 'BR-1', 'MAS', 'active']];
  const header = Array(19).fill(''); header[18] = 'Account Status';
  h.rows['Member programs'] = [header, ['ENR-1', 'MEM-1', 'PH-1', 'DP-1', month + '-01', 'BR-1', 'MAS-2']];
  h.rows.Programs = [[], ['DP-1', 'CODE', 'Program', 350]];
  const colHeader = Array(26).fill(''); colHeader[25] = 'Collected By Role'; colHeader[26] = 'Remittance Amount'; colHeader[27] = 'Remittance Breakdown';
  h.rows.Collections = [colHeader];
  const auditHeaders = h.load('lib/encoder-schema.ts').encoderHeaders;
  auditHeaders.forEach((v, i) => { header[14 + i] = v; colHeader[21 + i] = v; });
  const remHeader = Array(10).fill(''); auditHeaders.forEach((v, i) => { remHeader[6 + i] = v; });
  remHeader[10] = 'Gross Collection'; remHeader[11] = 'Total Remittance';
  h.rows.Remittances = [remHeader];
  h.rows['Program Incentives'] = [[], ['I1', 'DP-1', 'MAS', 1, 999, 'percentage', 50, 50]];
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: month, monthTo: month, amountCollected: 350, nopFrom: 1, nopTo: 1, orNumber: 'OR-1', orDate: today, collectedByRole: 'MAS' };
  const response = await h.load('app/api/collections/route.ts').POST(request({ branch: 'BR-1', mas: 'MAS-2', accountableEmployeeId: 'DPE-0002', dateRemitted: today, collections: [entry, { ...entry, monthFrom: next, monthTo: next, nopFrom: 2, nopTo: 2, orNumber: 'OR-2' }] }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(h.writes.length, 1);
  const requests = h.writes[0].requestBody.requests;
  assert.equal(requests.length, 2);
  for (const row of requests[0].appendCells.rows) {
    const values = row.values.map((v) => v.userEnteredValue.stringValue ?? v.userEnteredValue.numberValue);
    assert.deepEqual(values.slice(21, 24), ['USR-1', 'DPE-0001', '=encoder']);
    assert.equal(values[23], '=encoder');
    assert.equal(values[1], '');
    assert.equal(values[28], 'Outstanding');
    assert.equal(values[29], '');
    assert.equal(values[30], 'DPE-0002');
    assert.equal(values[26], 200);
  }
  assert.equal(requests[1].updateCells.rows[0].values[0].userEnteredValue.stringValue, 'ADV');
  assert.equal(result.remittanceId, undefined);
  assert.equal(result.grossCollection, 700);
});

test('collection member search matches branch and MAS and returns eligible programs', async () => {
  const h = harness();
  h.rows.Members = [[], ['M1', 'PH-001', 'Santos', 'Ana'], ['M2', 'PH-002', 'Santos', 'Ana Two']];
  h.rows['Member programs'] = [[],
    ['E1', 'M1', 'PH-001', 'P1', '', 'North', 'MAS One', '', '', '', '', '', 'Active'],
    ['E2', 'M1', 'PH-001', 'P2', '', 'North', 'MAS One', '', '', '', '', '', 'Active'],
    ['E3', 'M2', 'PH-002', 'P3', '', 'South', 'MAS One', '', '', '', '', '', 'Active'],
    ['E4', 'M2', 'PH-002', 'P4', '', 'North', 'MAS Two', '', '', '', '', '', 'Active'],
  ];
  const results = await h.load('lib/google-sheets-data.ts').searchMembersByName('ana', 'North', 'MAS One');
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'M1');
  assert.deepEqual(results[0].programIds, ['P1', 'P2']);
});

test('physical remittance links exact outstanding collections and records a discrepancy', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[4] = 'PH-1'; collection[5] = 'DP-1'; collection[6] = 'BR-1'; collection[7] = 'Maria'; collection[8] = 'OR-1'; collection[9] = '2026-09-25'; collection[10] = 350; collection[19] = 'Posted'; collection[25] = 'MAS'; collection[28] = 'Outstanding'; collection[30] = 'DPE-0002'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Remittances = [remittancesHeader];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At']];
  const response = await h.load('app/api/remittances/route.ts').POST(request({ collectionIds: ['COL-1'], actualAmount: 340, remittanceDate: '2026-09-26', receivedByName: 'Cashier' }));
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  assert.equal(result.remittance.status, 'Discrepancy');
  assert.equal(result.remittance.expectedAmount, 350);
  assert.equal(result.remittance.difference, -10);
  const requests = h.writes[0].requestBody.requests;
  const remittance = requests[0].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(remittance[4], 'Discrepancy');
  assert.deepEqual(remittance.slice(10, 13), [350, 340, -10]);
  const mapping = requests[1].appendCells.rows[0].values.map((value) => value.userEnteredValue.stringValue ?? value.userEnteredValue.numberValue);
  assert.equal(mapping[1], result.remittance.id);
  assert.equal(mapping[2], 'COL-1');
  assert.equal(mapping[3], 350);
  const status = requests[2].updateCells.rows[0].values.map((value) => value.userEnteredValue.stringValue);
  assert.deepEqual(status, ['Pending Remittance Approval', result.remittance.id]);
});

test('pending approval does not clear cash accountability', async () => {
  const h = harness();
  const collectionsHeader = Array(33).fill(''); collectionsHeader[28] = 'Remittance Status';
  const collection = Array(33).fill(''); collection[0] = 'COL-1'; collection[6] = 'BR-1'; collection[10] = 350; collection[19] = 'Posted'; collection[28] = 'Pending Remittance Approval'; collection[29] = 'REM-1'; collection[30] = 'DPE-2'; collection[31] = 'Maria'; collection[32] = 'MAS';
  const remittancesHeader = Array(24).fill(''); remittancesHeader[12] = 'Difference';
  const remittance = Array(24).fill(''); remittance[0] = 'REM-1'; remittance[1] = 'BR-1'; remittance[2] = 'Maria'; remittance[4] = 'Pending Approval'; remittance[10] = 350; remittance[11] = 350; remittance[13] = 'DPE-2'; remittance[14] = 'MAS'; remittance[15] = 1;
  h.rows.Collections = [collectionsHeader, collection];
  h.rows.Remittances = [remittancesHeader, remittance];
  h.rows['Remittance Collections'] = [['Remittance Collection ID', 'Remittance ID', 'Collection ID', 'Amount', 'Linked At'], ['RCL-1', 'REM-1', 'COL-1', 350]];
  const dashboard = await h.load('lib/remittance-workflow.ts').getRemittanceDashboard();
  assert.equal(dashboard.summary.outstandingAmount, 350);
  assert.equal(dashboard.summary.pendingAmount, 350);
  assert.equal(dashboard.outstanding.length, 0);
  assert.equal(dashboard.accountability[0].outstandingAmount, 350);
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
  const params = { range: 'Members!A:AD', requestBody: { values: [Array(30).fill('')] } };
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
  h.setUser({ userId: 'USR-2', employeeId: 'DPE-0002', username: 'second' });
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
  assert.equal(report.rows[0].periods[1].state.nop, 0);
});

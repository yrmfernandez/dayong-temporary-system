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
  const sheets = { spreadsheets: { values: {
    get: async ({ range }) => {
      const schema = load('lib/encoder-schema.ts').getEncoderSheet(range);
      return { data: { values: /1:.*1$/.test(range)
        ? [missingHeaders ? [] : load('lib/encoder-schema.ts').trackingHeaders(schema.title)]
        : (rows[schema.title] ?? [[]]) } };
    },
    append: async (params) => { writes.push(params); return { data: {} }; },
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

test('all mutation routes reject unauthenticated requests before writing', async () => {
  const h = harness(null);
  for (const route of ['sales', 'collections', 'branches', 'programs', 'program-incentives', 'user-accounts', 'attendance', 'attendance-reviews', 'leave-requests', 'leave-approvals']) {
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
      sales: [{ existingMember, memberNumber: existingMember ? 'PH-1' : '', programId: 'DP-1', addressBarangay: 'B', addressCity: 'C', addressProvince: 'P', encodedBy: 'attacker' }],
    }));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(h.writes.length, existingMember ? 2 : 3);
    const audit = h.writes.map((write) => write.requestBody.values[0].slice(-4));
    for (const values of audit) {
      assert.deepEqual(values.slice(0, 3), ["'USR-1", "'DPE-0001", "'=encoder"]);
      assert.equal(values[3], audit[0][3]);
      assert.ok(!Number.isNaN(Date.parse(values[3])));
    }
    assert.ok(!existingMember || h.writes.every((write) => !write.range.startsWith("'Members'!")));
  });
}

test('collection batch and remittance share the verified encoder and timestamp', async () => {
  const h = harness();
  h.rows.Members = [[], ['MEM-1', 'PH-1']];
  h.rows['Member programs'] = [[], ['ENR-1', 'MEM-1', 'PH-1', 'DP-1', '', 'BR-1', 'MAS-2']];
  const entry = { memberNumber: 'PH-1', programId: 'DP-1', monthFrom: '2026-09', monthTo: '2026-09', amountCollected: 100, nopFrom: 1, nopTo: 1, orNumber: 'OR-1', orDate: '2026-09-25' };
  const response = await h.load('app/api/collections/route.ts').POST(request({ branch: 'BR-1', mas: 'MAS-2', dateRemitted: '2026-09-25', collections: [entry, { ...entry, orNumber: 'OR-2' }] }));
  assert.equal(response.status, 201, JSON.stringify(await response.json()));
  assert.equal(h.writes.length, 2);
  const rows = h.writes.flatMap((write) => write.requestBody.values);
  assert.equal(rows.length, 3);
  rows.forEach((row) => assert.deepEqual(row.slice(-4), rows[0].slice(-4)));
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
      assert.equal(write.range, `'${schema.title}'!A:${columnName(schema.columns + 4)}`);
      assert.equal(write.requestBody.values[0].length, schema.columns + 4);
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

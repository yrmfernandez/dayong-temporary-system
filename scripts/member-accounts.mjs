/**
 * Why a member's programs do not show in Collections (owner, October 15, 2026). Read-only. Prints only the account
 * structure (program, branch, MAS, statuses), never personal details, and whether each account is listed in a
 * Collections batch: the batch lists a member's accounts whose branch and MAS are the batch's and whose status is
 * Active or blank (findMembers in lib/member-records.ts).
 *
 *   node scripts/member-accounts.mjs PH-93455604
 *   npm run prod -- node scripts/member-accounts.mjs PH-93455604
 *   Also accepts --name="Surname,First Middle" to find an existing member without printing personal fields;
 *   add --legacy to inspect workbook/export matches by source reference and account metadata only.
 *   --timestamp="10/12/2026 9:34:44" --sheet=BUTUAN-NS finds a source row by its Manila wall-clock timestamp.
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { loadLegacySources } from './legacy-sources.mjs';
import { readFileSync } from 'node:fs';

nextEnv.loadEnvConfig(process.cwd());
const requestedName = process.argv.find(arg => arg.startsWith('--name='))?.slice(7).trim();
const requestedTimestamp = process.argv.find(arg => arg.startsWith('--timestamp='))?.slice(12).trim();
let number = process.argv[2]?.startsWith('--') ? '' : process.argv[2]?.trim();
if (!number && !requestedName && !requestedTimestamp) { console.error("Usage: node scripts/member-accounts.mjs <member number> or --name=Surname,First Middle or --timestamp=M/D/YYYY HH:MM:SS"); process.exit(1); }
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  console.log(`Database ${/postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?"}`);
  if (requestedTimestamp) {
    const wallTime = value => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === 'number') return Date.UTC(1899, 11, 30) + Math.round(value * 86400000);
      const match = String(value ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})(?:\s*(AM|PM))?$/i);
      if (!match) return NaN;
      let hour = +match[4];
      if (match[7]) hour = hour % 12 + (match[7].toUpperCase() === 'PM' ? 12 : 0);
      return Date.UTC(+match[3], +match[1] - 1, +match[2], hour, +match[5], +match[6]);
    };
    const target = wallTime(requestedTimestamp);
    if (!Number.isFinite(target)) throw new Error('Timestamp must be M/D/YYYY HH:MM:SS.');
    const sheet = process.argv.find(arg => arg.startsWith('--sheet='))?.slice(8) || 'BUTUAN-NS';
    const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
    for (const source of sources) for (const tab of source.tabs.filter(tab => tab.title === sheet)) {
      const [header, ...rows] = tab.rows;
      const column = header.findIndex(value => String(value).trim().toUpperCase() === 'TIMESTAMP');
      if (column < 0) throw new Error('No Timestamp column in selected sheet.');
      const timed = rows.map((row, index) => ({ row, sourceRow: tab.firstRow + index + 1, time: wallTime(row[column]) })).filter(item => Number.isFinite(item.time));
      const hits = timed.filter(item => Math.abs(item.time - target) < 1000);
      const latest = Math.max(...timed.map(item => item.time));
      console.log(JSON.stringify({ inspectedSheet: sheet, rowsChecked: rows.length, timestampsRead: timed.length, timestampMatches: hits.length, latestTimestampWallClock: Number.isFinite(latest) ? new Date(latest).toISOString().replace('T', ' ').slice(0, 19) : null }));
      for (const hit of hits) {
        const col = key => header.findIndex(value => String(value).trim().toUpperCase() === key);
        console.log(JSON.stringify({ sourceRef: `Data-Base-Old|${sheet}|${hit.sourceRow}`, mas: hit.row[col('MARKETING AGENT')], branch: hit.row[col('BRANCH')], program: hit.row[col('DAYONG PROGRAM')] }));
      }
    }
    if (!requestedName && !number) { await sql.end(); process.exit(0); }
  }
  if (requestedName) {
    const [surname, rest] = requestedName.split(',').map(value => value.trim());
    if (!surname || !rest) throw new Error('Use Surname,First Middle.');
    const first = rest.split(/\s+/)[0];
    const matches = await sql`select member_id, member_number from members where concat_ws(' ', surname, first_name, middle_name) ilike ${'%' + surname + '%'} and concat_ws(' ', surname, first_name, middle_name) ilike ${'%' + first + '%'}`;
    console.log(JSON.stringify({ matchingMembers: matches }));
    if (process.argv.includes('--legacy')) {
      const words = value => String(value ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
      const wanted = words(requestedName);
      const sources = await loadLegacySources(['legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx']);
      for (const source of sources) for (const tab of source.tabs) {
        const requestedSheet = process.argv.find(arg => arg.startsWith('--sheet='))?.slice(8);
        if (requestedSheet && tab.title !== requestedSheet) continue;
        const [header, ...rows] = tab.rows;
        if (process.argv.includes('--scan-all-cells')) {
          const agentColumn = header.findIndex(value => String(value).toUpperCase().replace(/[^A-Z]/g, '') === 'MARKETINGAGENT');
          const distance = (a, b) => {
            let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
            for (let i = 1; i <= a.length; i++) {
              const current = [i];
              for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
              previous = current;
            }
            return previous[b.length];
          };
          for (const [index, row] of rows.entries()) for (const [column, value] of row.entries()) {
            const tokens = words(value);
            const mas = String(row[agentColumn] ?? '');
            const firstMatch = tokens.some(word => word.startsWith(first.toUpperCase()));
            const middleMatch = wanted.slice(2).some(word => tokens.includes(word));
            const masFilter = process.argv.find(arg => arg.startsWith('--mas='))?.slice(6);
            if (tokens.some(word => word.includes(surname.toUpperCase())) || middleMatch || (firstMatch && masFilter && mas.toUpperCase().includes(masFilter.toUpperCase()))) console.log(JSON.stringify({ sourceRef: `Data-Base-Old|${tab.title}|${tab.firstRow + index + 1}`, column: column + 1, field: header[column], mas, surnameMatch: tokens.includes(surname.toUpperCase()), firstMatch, middleMatch, closestSurnameDistance: Math.min(...tokens.map(word => distance(word, surname.toUpperCase()))) }));
          }
        }
        const headerKey = value => String(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
        const memberCol = header.findIndex(value => headerKey(value) === 'PHMEMBER');
        if (memberCol < 0) continue;
        const col = key => header.findIndex(value => headerKey(value) === headerKey(key));
        if (requestedSheet) {
          const distance = (a, b) => {
            let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
            for (let i = 1; i <= a.length; i++) {
              const current = [i];
              for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
              previous = current;
            }
            return previous[b.length];
          };
          const near = rows.map((row, index) => {
            const tokens = words(row[memberCol]);
            const differences = wanted.map(word => Math.min(...tokens.map(token => distance(word, token))));
            return { sourceRow: tab.firstRow + index + 1, differences, score: differences.reduce((a, b) => a + b, 0), mas: row[col('MARKETING AGENT')], branch: row[col('BRANCH')], program: row[col('DAYONG PROGRAM')] };
          }).filter(row => Number.isFinite(row.score)).sort((a, b) => a.score - b.score);
          console.log(JSON.stringify({ inspectedSheet: tab.title, memberColumn: memberCol + 1, rowsChecked: rows.length, closestMemberRows: near.slice(0, 5) }));
        }
        for (const [index, row] of rows.entries()) {
          const tokens = new Set(words(row[memberCol]));
          const surnameMatch = tokens.has(surname.toUpperCase());
          const firstMatch = [...tokens].some(word => word.startsWith(first.toUpperCase()));
          const middleMatch = wanted.slice(2).some(word => tokens.has(word));
          if (surnameMatch || (firstMatch && middleMatch)) console.log(JSON.stringify({ sourceRef: `Data-Base-Old|${tab.title}|${tab.firstRow + index + 1}`, surnameMatch, firstMatch, middleMatch, fullNameMatches: wanted.every(word => tokens.has(word)), mas: row[col('MARKETING AGENT')], branch: row[col('BRANCH')], program: row[col('DAYONG PROGRAM')] }));
        }
      }
      const exported = readFileSync('legacy-data/export/details/members.jsonl', 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      for (const row of exported) {
        const tokens = new Set(words([row.lname, row.fname, row.mname].join(' ')));
        if (tokens.has(surname.toUpperCase()) && [...tokens].some(word => word.startsWith(first.toUpperCase()))) console.log(JSON.stringify({ legacyWebMemberId: row.record_id, fullNameMatches: wanted.every(word => tokens.has(word)), mas: row.agent_id, masId: row.agent_id_value, hasBirthdate: Boolean(row.birthdate), hasAddress: Boolean(row.address) }));
      }
    }
    if (matches.length !== 1) throw new Error(`Expected one member; found ${matches.length}. Review legacy records before adding or changing one.`);
    number = matches[0].member_number;
  }
  const members = await sql`select member_id, status from members where member_number = ${number}`;
  console.log(`${number}: ${members.length} member record(s)${members.length ? `, status ${members.map((row) => row.status || "blank").join(", ")}` : ""}`);
  const accounts = await sql`
    select mp.enrollment_id, p.program_code, p.program_name, p.status as program_status, mp.branch, mp.mas, mp.mas_employee_id, mp.status, mp.doi::text as doi,
      (select count(*)::int from collections c where c.enrollment_id = mp.enrollment_id and c.status = 'Posted') as collections
    from member_programs mp join members m on m.member_id = mp.member_id left join programs p on p.program_id = mp.program_id
    where m.member_number = ${number} order by mp.doi, p.program_code`;
  for (const account of accounts) {
    const listed = !account.status || account.status.trim().toLowerCase() === "active";
    console.log(`- ${account.program_code} (${account.program_name}; program ${account.program_status}) | branch ${account.branch || "blank"} | MAS ${account.mas || "blank"} (${account.mas_employee_id || "no employee link"}) | account ${account.status || "blank"} | DOI ${account.doi || "blank"} | ${account.collections} collections | ${listed ? `listed in a ${account.branch} batch of ${account.mas}` : "NOT listed: account status is not Active"}`);
  }
  const places = new Set(accounts.map((account) => `${(account.branch ?? "").trim().toLowerCase()}|${(account.mas ?? "").trim().toLowerCase()}`));
  if (places.size > 1) console.log(`\nThe accounts are under ${places.size} different branch / MAS pairs, so one Collections batch shows only the accounts of its own pair.`);
} finally {
  await sql.end();
}

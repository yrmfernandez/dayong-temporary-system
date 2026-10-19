/** Read-only audit for D-210 HG histories with a small number of receipts on another account. */
import fs from 'node:fs';
import nextEnv from '@next/env';
import postgres from 'postgres';
nextEnv.loadEnvConfig(process.cwd());
const db = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  await db.begin('isolation level repeatable read read only', async tx => {
    const accounts = await tx`select a.enrollment_id,a.member_id,m.member_number,a.program_id,p.program_name,a.doi::text from member_programs a join members m on m.member_id=a.member_id join programs p on p.program_id=a.program_id`;
    const payments = await tx`select collection_id,member_id,enrollment_id,program_id,or_number,or_date::text,amount_collected::float8 as amount,nop_from,nop_to,month_from,month_to from collections where status='Posted'`;
    const byMember = new Map(), byAccount = new Map();
    for (const a of accounts) { const list = byMember.get(a.member_id) ?? []; list.push(a); byMember.set(a.member_id, list); }
    for (const p of payments) { const list = byAccount.get(p.enrollment_id) ?? []; list.push(p); byAccount.set(p.enrollment_id, list); }
    const candidates = [];
    for (const target of accounts.filter(a => a.program_id === 'DP-0005')) {
      const main = byAccount.get(target.enrollment_id) ?? [];
      if (main.length < 4) continue;
      for (const other of byMember.get(target.member_id) ?? []) {
        if (other.enrollment_id === target.enrollment_id || other.program_id === target.program_id || other.doi !== target.doi) continue;
        const minority = byAccount.get(other.enrollment_id) ?? [];
        if (!minority.length || minority.length > 2) continue;
        const history = [...main, ...minority].sort((a,b) => a.or_date.localeCompare(b.or_date) || a.collection_id.localeCompare(b.collection_id));
        // Parallel receipts suggest two legitimate accounts rather than a single history split by program.
        if (main.some(p => minority.some(q => q.or_date === p.or_date))) continue;
        const continuousNop = history.every((p,i) => !i || p.nop_from === history[i-1].nop_to + 1);
        const coveredMonths = history.reduce((sum,p) => sum + p.nop_to - p.nop_from + 1,0);
        candidates.push({ member: target.member_number, targetAccount: target.enrollment_id, otherAccount: other.enrollment_id, otherProgram: other.program_name, doi: target.doi, targetReceipts: main.length, minorityReceipts: minority.length, continuousNop, coveredMonths, receipts: history.map(p => ({ ...p, program: p.enrollment_id === target.enrollment_id ? 'D-210 HG' : other.program_name })) });
      }
    }
    candidates.sort((a,b) => Number(b.continuousNop)-Number(a.continuousNop) || a.minorityReceipts-b.minorityReceipts || b.targetReceipts-a.targetReceipts || a.member.localeCompare(b.member));
    const base = 'legacy-data/d210-split-review-2026-10-19';
    fs.writeFileSync(base+'.json',JSON.stringify({generatedAt:new Date().toISOString(),readOnly:true,candidates},null,2));
    fs.writeFileSync(base+'.md', ['# D-210 HG split-history review','','Read-only production scan. Same DOI, at least four D-210 HG receipts, one or two receipts on another account, and no parallel receipt dates. These signals do not determine the intended program; source/owner confirmation is required.','','| Member | Other program | D-210 receipts | Other receipts | Continuous NOP |','| --- | --- | ---: | ---: | --- |',...candidates.map(c => `| ${c.member} | ${c.otherProgram} | ${c.targetReceipts} | ${c.minorityReceipts} | ${c.continuousNop} |`)].join('\n'));
    console.log(JSON.stringify({count:candidates.length,first:candidates.slice(0,15).map(({receipts,...c}) => c),report:base+'.md'},null,2));
  });
} finally { await db.end(); }

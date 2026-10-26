/**
 * Owner-authorized merge of one duplicate employee into the original.
 * node scripts/merge-employee-pair.mjs --duplicate MD-2026-0084 --keep MD-2026-0063 [--apply | --verify] [--activate] [--attendance-from duplicate|keep]
 * --activate sets the kept employee active (owner, October 26, 2026: the kept ID was inactive while the duplicate was
 * the one in use). --attendance-from chooses whose record stays when both have a different real record on one day;
 * without it such days stop the merge and are listed.
 * Use scripts/prod.mjs for production. Default: execute and roll back the whole transaction.
 * Keeps the original's login/password/permissions. Relinks the duplicate login's transaction references before
 * deleting it. Combines branch assignments and identical same-day attendance; refuses conflicting attendance,
 * two pay profiles, ambiguous name-only references or report-note key collisions. Audit history is preserved.
 * Prints IDs/counts only. Every write is audited and the merge is summarized in Record Corrections.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const arg = (name) => { const index = process.argv.indexOf(name); return index < 0 ? "" : process.argv[index + 1] ?? ""; };
const duplicate = arg("--duplicate"), keep = arg("--keep");
if (!duplicate || !keep || duplicate === keep || duplicate.startsWith("--") || keep.startsWith("--")) throw new Error("Supply distinct --duplicate and --keep employee IDs.");
const apply = process.argv.includes("--apply"), verify = process.argv.includes("--verify"), activate = process.argv.includes("--activate");
const attendanceFrom = arg("--attendance-from");
if (attendanceFrom && !["duplicate", "keep"].includes(attendanceFrom)) throw new Error("--attendance-from is duplicate or keep.");
if (apply && verify) throw new Error("Choose --apply or --verify.");
if (!process.env.DIRECT_DATABASE_URL) throw new Error("Missing DIRECT_DATABASE_URL.");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, onnotice: () => {} });
const normalize = (value) => String(value ?? "").trim().toLowerCase();
const NAME_COLUMN = /^(mas|mas_name|from_mas|to_mas|original_mas|accountable_name|employee_name|full_name|.*_by_name)$/;
const ATTENDANCE_FIELDS = ["branch", "scheduled_time_in", "scheduled_time_out", "time_in", "time_out", "worked_hours", "overtime_hours", "attendance_status", "late_minutes", "undertime_minutes", "leave_type", "leave_approval_status", "notes"];
class Rollback extends Error {}

try {
  const columns = await sql`select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t using (table_catalog, table_schema, table_name)
    where c.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.table_name <> 'audit_log'
      and (c.column_name like '%employee\_id' or c.column_name like '%user\_id' or c.column_name ~ ${NAME_COLUMN.source})
    order by c.table_name, c.column_name`;
  const ids = columns.filter((c) => c.column_name.endsWith("employee_id") && !(c.table_name === "employees" && c.column_name === "employee_id"));
  const references = async (tx) => {
    const remaining = [];
    for (const c of ids) {
      const [{ count }] = await tx`select count(*)::int as count from ${tx(c.table_name)} where ${tx(c.column_name)} = ${duplicate}`;
      if (count) remaining.push({ ...c, count });
    }
    return remaining;
  };
  if (verify) {
    const remaining = await references(sql);
    const employees = await sql`select employee_id from employees where employee_id in (${duplicate}, ${keep})`;
    const corrections = await sql`select correction_id, before_json->>'user' as duplicate_user, after_json->>'user' as kept_user
      from record_corrections where module = 'Employee merge' and record_id = ${duplicate}`;
    const userReferences = [];
    for (const correction of corrections.filter((c) => c.duplicate_user && c.duplicate_user !== c.kept_user)) {
      for (const c of columns.filter((c) => c.column_name.endsWith("user_id"))) {
        const [{ count }] = await sql`select count(*)::int as count from ${sql(c.table_name)} where ${sql(c.column_name)} = ${correction.duplicate_user}`;
        if (count) userReferences.push({ ...c, count });
      }
    }
    if (remaining.length || userReferences.length || employees.length !== 1 || employees[0].employee_id !== keep || !corrections.length) throw new Error(`Verification failed: ${JSON.stringify({ employees, remaining, userReferences, corrections })}`);
    console.log(JSON.stringify({ duplicate, keep, duplicateDeleted: true, remainingEmployeeReferences: 0, remainingDuplicateUserReferences: 0, correctionRecords: corrections.length }));
  } else {
    await sql.begin(async (tx) => {
      const employees = await tx`select employee_id, full_name, employment_status from employees where employee_id in (${duplicate}, ${keep}) order by employee_id for update`;
      const dup = employees.find((e) => e.employee_id === duplicate), kept = employees.find((e) => e.employee_id === keep);
      if (!dup || !kept) throw new Error("Both employee records must exist; use --verify after applying.");
      const users = await tx`select user_id, employee_id from users where employee_id in (${duplicate}, ${keep}) order by user_id for update`;
      const dupUser = users.find((u) => u.employee_id === duplicate), keepUser = users.find((u) => u.employee_id === keep);
      // Before anything changes: each one's status and sign-in, so the owner can check the kept one is the one in use.
      const describe = (e) => e && ({ id: e.employee_id, status: e.employment_status || "(blank)", signIn: users.find((u) => u.employee_id === e.employee_id)?.user_id ?? "none" });
      console.log(JSON.stringify({ before: { duplicate: describe(dup), keep: describe(kept) } }));
      const [{ profiles }] = await tx`select count(*)::int as profiles from pay_profiles where employee_id in (${duplicate}, ${keep})`;
      if (profiles > 1) throw new Error("Both employees have pay profiles; reconcile them first.");
      const [{ ambiguous }] = await tx`select count(*)::int as ambiguous from employees where employee_id not in (${duplicate}, ${keep}) and lower(trim(full_name)) = lower(trim(${dup.full_name}))`;
      if (ambiguous) throw new Error("Another employee shares the duplicate name; name-only references need review.");
      await tx`select set_config('app.user_name', 'Owner-requested employee merge', true)`;
      const changed = [];
      const note = (table, column, count) => { if (count) changed.push({ table, column, count }); };
      // One attendance record per employee/day. Only collapse rows with identical operational data.
      const attendance = await tx`select * from attendance where employee_id in (${duplicate}, ${keep}) for update`;
      // A system absence ("Absent by system", written for a day with no clock-in) gives way to a real record of the same
      // day, as the app shows it (lib/attendance-data.ts); two system absences are the same. Other differences stop the
      // merge and are all listed (date, IDs and the differing fields) for the owner to decide.
      const bySystem = (row) => String(row.notes ?? "").startsWith("Absent by system");
      const conflicts = [];
      for (const row of attendance.filter((a) => a.employee_id === duplicate)) {
        const target = attendance.find((a) => a.employee_id === keep && a.attendance_date.getTime() === row.attendance_date.getTime());
        if (!target) continue;
        const differing = ATTENDANCE_FIELDS.filter((field) => String(row[field] ?? "") !== String(target[field] ?? ""));
        if (!differing.length || bySystem(row)) { note("attendance", differing.length ? "system_absence_deleted" : "identical_duplicate_deleted", (await tx`delete from attendance where attendance_id = ${row.attendance_id} returning 1`).length); continue; }
        if (bySystem(target)) { note("attendance", "kept_system_absence_replaced", (await tx`delete from attendance where attendance_id = ${target.attendance_id} returning 1`).length); continue; }
        const conflict = { date: row.attendance_date.toISOString().slice(0, 10), duplicate: row.attendance_id, keep: target.attendance_id,
          differing: Object.fromEntries(differing.map((field) => [field, { duplicate: row[field], keep: target[field] }])) };
        if (!attendanceFrom) { conflicts.push(conflict); continue; }
        // The owner's choice: the other one's record of that day is deleted (the audit log keeps it).
        console.log(JSON.stringify({ attendanceChoice: attendanceFrom, ...conflict }));
        const drop = attendanceFrom === "duplicate" ? target.attendance_id : row.attendance_id;
        note("attendance", `conflict_kept_${attendanceFrom}`, (await tx`delete from attendance where attendance_id = ${drop} returning 1`).length);
      }
      if (conflicts.length) throw new Error(`Conflicting attendance on ${conflicts.length} day(s); nothing was changed:\n${JSON.stringify(conflicts, null, 2)}`);
      note("employee_branches", "duplicate_assignment_deleted", (await tx`delete from employee_branches d where d.employee_id = ${duplicate} and exists
        (select 1 from employee_branches k where k.employee_id = ${keep} and k.branch_id = d.branch_id) returning 1`).length);
      // Keep the original login's credentials and roles; only transaction references are reassigned.
      if (dupUser && keepUser) {
        for (const c of columns.filter((c) => c.column_name.endsWith("user_id") && !["users", "user_roles"].includes(c.table_name))) {
          note(c.table_name, c.column_name, (await tx`update ${tx(c.table_name)} set ${tx(c.column_name)} = ${keepUser.user_id} where ${tx(c.column_name)} = ${dupUser.user_id} returning 1`).length);
        }
        note("users", "duplicate_login_deleted", (await tx`delete from users where user_id = ${dupUser.user_id} returning 1`).length);
      }
      // Change each employee link together with its display name, so name-to-ID triggers keep the chosen employee.
      for (const c of ids) {
        const name = c.column_name === "employee_id" ? (c.table_name === "users" ? "full_name" : "employee_name")
          : c.column_name === "mas_employee_id" ? (c.table_name === "fidelity" ? "mas_name" : "mas")
          : c.column_name === "from_employee_id" ? "from_mas" : c.column_name === "to_employee_id" ? "to_mas"
          : c.column_name.replace(/employee_id$/, "name");
        const hasName = columns.some((n) => n.table_name === c.table_name && n.column_name === name);
        const values = { [c.column_name]: keep, ...(hasName ? { [name]: kept.full_name } : {}) };
        note(c.table_name, c.column_name, (await tx`update ${tx(c.table_name)} set ${tx(values)} where ${tx(c.column_name)} = ${duplicate} returning 1`).length);
      }
      if (normalize(dup.full_name) !== normalize(kept.full_name)) {
        for (const c of columns.filter((c) => NAME_COLUMN.test(c.column_name) && c.table_name !== "employees")) {
          note(c.table_name, c.column_name, (await tx`update ${tx(c.table_name)} set ${tx(c.column_name)} = ${kept.full_name} where lower(trim(${tx(c.column_name)})) = lower(trim(${dup.full_name})) returning 1`).length);
        }
      }
      note("report_notes", "note_key", (await tx`update report_notes set note_key = ${keep} || substr(note_key, ${duplicate.length + 1}) where starts_with(note_key, ${`${duplicate}|`}) returning 1`).length);
      const remaining = await references(tx);
      if (remaining.length) throw new Error(`Duplicate links remain: ${JSON.stringify(remaining)}`);
      await tx`delete from employees where employee_id = ${duplicate}`;
      if (activate) note("employees", "kept_set_active", (await tx`update employees set employment_status = 'active' where employee_id = ${keep} and employment_status is distinct from 'active' returning 1`).length);
      const now = new Date().toISOString();
      await tx`insert into record_corrections ${tx({ correction_id: `COR-EMP-${duplicate}-${Date.now().toString(36).toUpperCase()}`, module: "Employee merge", record_id: duplicate,
        reason: `Owner confirmed ${duplicate} is a duplicate of ${keep}; reassign all transaction references and delete the duplicate.`,
        before_json: { employee: duplicate, user: dupUser?.user_id ?? null }, after_json: { employee: keep, user: keepUser?.user_id ?? dupUser?.user_id ?? null, changed },
        corrected_at: now, encoded_by_name: "Owner-requested employee merge", encoded_at: now })}`;
      console.log(JSON.stringify({ duplicate, keep, changed, duplicateDeleted: true }, null, 2));
      if (!apply) throw new Rollback();
    });
    console.log("Applied.");
  }
} catch (error) {
  if (!(error instanceof Rollback)) throw error;
  console.log("Dry run: all changes rolled back. Use --apply to write.");
} finally {
  await sql.end();
}

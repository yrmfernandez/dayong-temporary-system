/**
 * Owner, October 15, 2026: copy the paper attendance sheet for October 1–15, 2026 (two photos, typed in below) into each
 * employee's attendance. Where the system already has that person's attendance for the day (a clock-in, leave, or a
 * management mark), the system record is kept. A system absence ("Absent by system", no clock-in) is not attendance,
 * so the paper sheet replaces it.
 *
 *   node scripts/import-paper-attendance-20261015.mjs            (dry run: prints the plan, writes nothing)
 *   npm run prod -- node scripts/import-paper-attendance-20261015.mjs --apply
 *
 * Codes: a time is the time in (Present; late after the 20-minute grace, as the clock-in counts it; no time out), P
 * present with no times, LEAVE leave, A absent, RD / RD- rest day (Day Off). ND (no data), NA, and blank cells are
 * skipped: nothing is written for them. The sheet header reads 2016, but its weekdays (Thu October 1) are 2026's.
 */
import nextEnv from "@next/env";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
const ref = /postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?";

const NOTE = "From the paper attendance sheet, October 1-15, 2026 (time in only)"; // starts with PAPER_SHEET_NOTE (lib/attendance-sheet.ts)
const BY = "Paper attendance sheet import";
const DAYS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// [employee ID, name on the paper sheet, name in the system, cells for October 1..15 ("" = blank)]
const SHEET = [
  [null, "GULTIANO, MARCLEONITZ", null, ["", "", "", "", "", "", "", "", "", "", "", "P", "", "", ""]],
  ["MD-2026-0004", "BAUTISTA, JO-ANN", "BAUTISTA, JO-ANN E.", ["5:00", "ND", "", "", "P", "P", "7:40", "7:55", "P", "", "", "P", "P", "7:32", ""]],
  ["MD-2026-0076", "ABAS, RYE-EL", "ABAS, RYE-EL", ["5:00", "ND", "", "", "7:30", "7:34", "7:40", "7:55", "LEAVE", "7:56", "", "7:33", "7:58", "7:32", ""]],
  ["MD-2026-0007", "CAERLANG, APRIL", "CAERLANG, APRIL N.", ["5:00", "ND", "", "", "7:30", "7:52", "7:55", "7:55", "7:33", "7:56", "", "7:33", "7:43", "7:32", ""]],
  ["MD-2026-0049", "POTENCIANDO, KISHA KAREN", "POTENCIANDO, KISHA KAREN", ["7:43", "ND", "", "", "7:30", "7:34", "7:35", "7:55", "7:33", "7:56", "", "7:33", "6:53", "7:32", ""]],
  ["MD-2026-0063", "BARANDA, MABEL", "BARANDA, MABEL", ["7:43", "ND", "", "", "7:30", "RD-", "7:29", "RD", "7:33", "7:56", "", "7:33", "RD", "7:32", "RD"]],
  ["MD-2026-0057", "GARCIA, JASPER", "GARCIA, JASPER", ["7:43", "ND", "", "", "7:30", "10:06", "7:29", "7:17", "7:33", "7:56", "", "7:33", "7:43", "7:32", ""]],
  ["MD-2026-0077", "ABESIA, DARYL JANE", "ABESIA, DARYL JANE", ["7:43", "ND", "", "", "8:43", "10:59", "9:09", "8:26", "RD", "8:42", "", "7:33", "NA", "9:59", ""]],
  ["MD-2026-0078", "CABALLERO, JENNY", "CABALLERO, JENNY", ["7:43", "ND", "", "", "7:30", "7:52", "8:16", "RD", "7:33", "8:59", "", "7:33", "7:58", "7:32", "RD"]],
  ["MD-2026-0081", "BARRIENTOS, RUTCHELYN", "BARRIENTOS, RUTCHELYN", ["7:43", "ND", "", "", "7:30", "RD", "7:56", "8:18", "7:33", "7:34", "", "7:33", "RD", "7:32", ""]],
  ["MD-2026-0002", "AMBASING, CHARNNY", "AMBASING, CHARNNY", ["7:43", "8:05", "", "", "7:30", "RD", "7:29", "7:17", "7:33", "7:56", "", "7:33", "7:14", "7:32", "RD"]],
  ["DNDO-2026-0075", "PACIOS, CIARA JOI", "PACIOS, CIARA JOI", ["ND", "8:05", "", "", "7:30", "RD", "7:29", "7:17", "7:33", "NA", "", "7:33", "7:14", "7:32", ""]],
  ["DNDO-2026-0003", "PAÑARES, NIMFA", "PAÑARES, NIMFA", ["ND", "7:39", "", "", "RD", "7:34", "7:29", "7:17", "7:12", "7:34", "", "7:33", "7:14", "7:32", ""]],
  ["DNDO-2026-0082", "BALCOS, MARJORIE", "BALCOS, MARJORIE", ["ND", "7:39", "", "", "7:19", "7:52", "RD", "7:17", "7:12", "NA", "", "7:33", "7:14", "RD", ""]],
  ["MD-2026-0083", "BACLAYON, JULICAR", "Julicar Baclayon", ["7:43", "8:28", "", "", "7:30", "RD", "RD", "7:17", "RD", "7:56", "", "7:33", "RD", "RD", ""]],
  ["MD-2026-0082", "FERNANDEZ, YMAN REY", "Yman Rey Fernandez", ["7:43", "ND", "", "", "8:30", "8:00", "RD", "7:55", "7:33", "8:02", "", "7:33", "8:09", "7:32", ""]],
  ["LEG-2026-0065", "NAGLIBA, MARISSA", "NAGLIBA, MARISSA", ["ND", "ND", "", "", "7:19", "6:06", "7:29", "7:17", "7:12", "7:56", "", "7:33", "6:53", "7:32", ""]],
  ["LEG-2026-0003", "ALBURO, MERAFE", "ALBURO, MERAFE", ["7:43", "ND", "", "", "7:30", "7:21", "7:29", "7:17", "7:33", "7:34", "", "7:33", "7:14", "7:32", ""]],
  ["MD-2026-0080", "ORO", "ORO, CARMELINA", ["P", "ND", "", "", "P", "P", "P", "7:55", "7:33", "7:56", "", "7:33", "", "", ""]],
  ["DNDO-2026-0072", "LEGASPINA, ROWENA", "LEGASPINA, ROWENA", ["ND", "P", "", "", "7:30", "", "", "", "P", "", "", "P", "", "", ""]],
  ["MD-2026-0023", "VILLAGRACIA,", "VILLAGRACIA, LILIBETH", ["P", "ND", "", "", "P", "", "", "P", "", "", "", "", "", "", ""]],
  ["MD-2026-0022", "PUYA", "PUYA, JIRAMAY", ["", "", "", "", "", "", "", "", "", "", "", "", "", "9:35", ""]],
  ["DNDO-2026-0085", "POROL, RIZA MAE", "POROL, RIZA MAE", ["ND", "8:05", "", "", "7:30", "7:52", "", "7:55", "7:33", "P", "", "7:58", "A", "A", ""]],
];

// Late minutes as lib/attendance.ts counts them: after 08:00 plus the 20-minute grace, without the 12:00–13:00 break.
const minutesOf = (time) => { const [h, m] = time.split(":").map(Number); return h * 60 + m; };
function lateMinutes(timeIn) {
  const from = minutesOf("08:00") + 20, to = minutesOf(timeIn);
  if (to <= from) return 0;
  return to - from - Math.max(0, Math.min(to, minutesOf("13:00")) - Math.max(from, minutesOf("12:00")));
}

function paperRecord(code) {
  const base = { time_in: null, time_out: null, worked_hours: 0, overtime_hours: 0, late_minutes: 0, undertime_minutes: 0, leave_type: null, leave_approval_status: null };
  const time = /^(\d{1,2}):(\d{2})$/.exec(code);
  if (time) { const timeIn = `${time[1].padStart(2, "0")}:${time[2]}`; return { ...base, attendance_status: "Present", time_in: timeIn, late_minutes: lateMinutes(timeIn) }; }
  if (code === "P") return { ...base, attendance_status: "Present" };
  if (code === "LEAVE") return { ...base, attendance_status: "Leave", leave_type: "Leave", leave_approval_status: "Approved" };
  if (code === "A") return { ...base, attendance_status: "Absent" };
  if (code === "RD" || code === "RD-") return { ...base, attendance_status: "Day Off" };
  return null;
}

class DryRun extends Error {}
const plan = { inserted: [], replacedSystemAbsence: [], keptSystem: [], skipped: [], notInSystem: [] };
console.log(`Database ${ref}${apply ? " (APPLY)" : " (dry run)"}`);
try {
  await sql.begin(async (tx) => {
    await tx`select set_config('app.user_name', ${BY}, true)`;
    const stamp = new Date().toISOString();
    for (const [employeeId, paperName, systemName, cells] of SHEET) {
      if (cells.length !== DAYS.length) throw new Error(`${paperName}: ${cells.length} cells, expected ${DAYS.length}.`);
      if (!employeeId) { plan.notInSystem.push(`${paperName}: ${cells.map((code, i) => code && `Oct ${DAYS[i]} ${code}`).filter(Boolean).join(", ")}`); continue; }
      const [employee] = await tx`select employee_id, full_name, primary_branch from employees where employee_id = ${employeeId}`;
      if (employee?.full_name !== systemName) throw new Error(`${employeeId} is ${employee?.full_name ?? "missing"}, expected ${systemName}.`);
      for (const [index, code] of cells.entries()) {
        const date = `2026-10-${String(DAYS[index]).padStart(2, "0")}`;
        const values = paperRecord(code);
        if (!values) { if (code) plan.skipped.push(`${systemName} ${date} ${code}`); continue; }
        const existing = await tx`select attendance_id, attendance_status, time_in, time_out, notes from attendance where employee_id = ${employeeId} and attendance_date = ${date} order by row_seq for update`;
        const real = existing.filter((row) => !(row.notes ?? "").startsWith("Absent by system"));
        if (real.length) {
          plan.keptSystem.push(`${systemName} ${date}: paper ${code}, system ${real.map((row) => `${row.attendance_status}${row.time_in ? ` ${row.time_in}${row.time_out ? `-${row.time_out}` : ""}` : ""}`).join(" / ")}`);
          continue;
        }
        const record = {
          ...values, branch: employee.primary_branch, scheduled_time_in: "08:00", scheduled_time_out: "17:00", notes: NOTE, updated_at: stamp,
          updated_by_name: BY,
        };
        if (existing.length) {
          // The system absence becomes the paper record; its other copies (if two servers closed the day) are removed.
          await tx`update attendance set ${tx(record)} where attendance_id = ${existing[0].attendance_id}`;
          if (existing.length > 1) await tx`delete from attendance where attendance_id in ${tx(existing.slice(1).map((row) => row.attendance_id))}`;
          plan.replacedSystemAbsence.push(`${systemName} ${date} ${code}`);
        } else {
          await tx`insert into attendance ${tx({ ...record, attendance_id: `ATT-PAPER-${employeeId}-${date}`, employee_id: employeeId, attendance_date: date, created_at: stamp, encoded_by_name: BY, encoded_at: stamp })}`;
          plan.inserted.push(`${systemName} ${date} ${code}`);
        }
      }
    }
    for (const [label, list] of Object.entries(plan)) {
      console.log(`\n${label}: ${list.length}`);
      for (const line of list) console.log(`  ${line}`);
    }
    if (!apply) throw new DryRun();
  });
  console.log(apply ? "\nApplied." : "");
} catch (error) {
  if (error instanceof DryRun) console.log("\nDry run rolled back. Add --apply to write.");
  else throw error;
} finally {
  await sql.end();
}

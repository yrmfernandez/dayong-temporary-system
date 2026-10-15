/**
 * Read-only check of an owner-supplied list of a MAS's members (owner, October 15, 2026): for each name, the members in
 * the database with that surname and first name (IDs, member number, and each account's program, branch, MAS and
 * status), and the old-sheet workbook rows and old web app records with that name (source references, MAS, branch,
 * program only). Prints no member personal details beyond the names the owner supplied.
 *
 *   node scripts/check-mas-members.mjs --mas="CONDES, MILDRED" --names="WILLIAM BOLO MOMO;ANITA VILLAGONZALO"
 *   npm run prod -- node scripts/check-mas-members.mjs --mas="CONDES, MILDRED" --names-file=config/condes-members-20261015.json
 *
 * Names are "First Middle Surname" (the last word is the surname); a leading dot or bullet is ignored.
 * Verdicts: UNDER MAS (every match is already under that MAS), OTHER MAS (in the database under another MAS),
 * NOT IN DATABASE (with or without old-source rows to import from), or SEVERAL (more than one member; owner to choose).
 */
import nextEnv from "@next/env";
import postgres from "postgres";
import { existsSync, readFileSync } from "node:fs";
import { loadLegacySources } from "./legacy-sources.mjs";
import { candidateMembers, matchesName } from "./name-match.mjs";

nextEnv.loadEnvConfig(process.cwd());
const arg = (key) => process.argv.find((value) => value.startsWith(`--${key}=`))?.slice(key.length + 3);
const mas = arg("mas")?.trim() ?? "";
const namesFile = arg("names-file");
const names = (namesFile ? JSON.parse(readFileSync(namesFile, "utf8")).names : (arg("names") ?? "").split(";"))
  .map((name) => String(name).replace(/^[\s.•*-]+/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
if (!mas || !names.length) { console.error('Usage: --mas="SURNAME, FIRST" and --names="First Middle Surname;..." or --names-file=<json with "names">'); process.exit(1); }

const words = (value) => String(value ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
const key = (value) => words(value).join(" ");
const masWords = words(mas);
// "CONDES, MILDRED", "Condes, M." and "Mildred Condes" all name the same MAS: the surname plus the first initial.
const sameMas = (value) => { const w = words(value); return w.includes(masWords[0]) && w.some((word) => word[0] === masWords[1]?.[0]); };

const sql = postgres(process.env.DIRECT_DATABASE_URL, { max: 1, connect_timeout: 15, onnotice: () => {} });
try {
  console.log(`Database ${/postgres\.([a-z0-9]+)[:@]/.exec(process.env.DIRECT_DATABASE_URL ?? "")?.[1] ?? "?"} · MAS ${mas} · ${names.length} name(s)\n`);

  // Old sources, read once: the newest old-sheet workbook and the old web app export.
  const workbook = "legacy-data/old-data/2026 DATABASE (NS + COLL).xlsx";
  const sheetRows = [];
  if (existsSync(workbook)) {
    for (const source of await loadLegacySources([workbook])) for (const tab of source.tabs) {
      const [header, ...rows] = tab.rows;
      const column = (name) => header.findIndex((value) => key(value).replace(/ /g, "") === name.replace(/ /g, ""));
      const member = column("PH MEMBER"), agent = column("MARKETING AGENT"), branch = column("BRANCH"), program = column("DAYONG PROGRAM");
      if (member < 0) continue;
      rows.forEach((row, index) => sheetRows.push({ ref: `${tab.title}|${tab.firstRow + index + 1}`, tokens: new Set(words(row[member])), mas: String(row[agent] ?? "").trim(), branch: String(row[branch] ?? "").trim(), program: String(row[program] ?? "").trim() }));
    }
  }
  const webFile = "legacy-data/export/details/members.jsonl";
  const webRows = existsSync(webFile) ? readFileSync(webFile, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .map((row) => ({ id: row.record_id, tokens: new Set(words([row.fname, row.mname, row.lname].join(" "))), mas: String(row.agent_id ?? "").trim() })) : [];

  const summary = [];
  for (const name of names) {
    const w = words(name), surname = w[w.length - 1], first = w[0];
    const found = await candidateMembers(sql, name);
    const members = found.filter((row) => matchesName(row, name));
    for (const member of members) member.accounts = await sql`select mp.enrollment_id as enrollment, p.program_code as program, mp.branch, mp.mas, mp.mas_employee_id as "masId", mp.status, mp.doi::text as doi
      from member_programs mp left join programs p on p.program_id = mp.program_id where mp.member_id = ${member.member_id} order by mp.doi`;
    const inSheet = sheetRows.filter((row) => row.tokens.has(surname) && [...row.tokens].some((word) => word.startsWith(first)));
    const inWeb = webRows.filter((row) => row.tokens.has(surname) && [...row.tokens].some((word) => word.startsWith(first)));

    let verdict;
    if (members.length > 1) verdict = "SEVERAL";
    else if (members.length === 1) verdict = members[0].accounts.length && members[0].accounts.every((account) => sameMas(account.mas)) ? "UNDER MAS" : "OTHER MAS";
    else verdict = inSheet.length || inWeb.length ? "NOT IN DATABASE (in old sources)" : "NOT IN DATABASE (no old source)";
    summary.push([name, verdict]);

    console.log(`${name}: ${verdict}`);
    for (const member of members) {
      console.log(`  member ${member.member_number} (${member.member_id}) ${member.status || ""}${key(member.full_name) !== key(name) ? ` · recorded as ${member.full_name}` : ""}`);
      for (const account of member.accounts) console.log(`    ${account.program} · ${account.branch || "no branch"} · MAS ${account.mas || "none"} (${account.masId || "no link"}) · ${account.status || "no status"} · DOI ${account.doi || "?"} · ${account.enrollment}`);
      if (!member.accounts.length) console.log("    no program account");
    }
    for (const row of inSheet) console.log(`  old sheet ${row.ref} · MAS ${row.mas || "?"} · ${row.branch || "?"} · ${row.program || "?"}${sameMas(row.mas) ? "" : "  (other MAS)"}`);
    for (const row of inWeb) console.log(`  old web app member ${row.id} · MAS ${row.mas || "?"}${sameMas(row.mas) ? "" : "  (other MAS)"}`);
    console.log("");
  }
  console.log("Summary");
  for (const [name, verdict] of summary) console.log(`  ${verdict.padEnd(34)} ${name}`);
} finally {
  await sql.end();
}

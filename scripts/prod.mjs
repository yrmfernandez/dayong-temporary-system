/**
 * Runs one command against production, so .env.local can stay on staging for good.
 *
 *   npm run prod -- node scripts/fill-member-contacts.mjs
 *   npm run prod -- npm run db:migrate
 *
 * Production values live in .env.prod-scripts (ignored by git, never committed): DATABASE_URL, DIRECT_DATABASE_URL,
 * SUPABASE_URL, SUPABASE_SERVICE_KEY. They are given to that one command only. The scripts load .env.local with
 * @next/env, which never overrides a value already set, so the command sees production, and the Google values still
 * come from .env.local.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PRODUCTION_REF = "qnugejonwpfvsenxvhxz";
const FILE = ".env.prod-scripts";
const REQUIRED = ["DATABASE_URL", "DIRECT_DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"];

const command = process.argv.slice(2);
if (!command.length) { console.error("Usage: npm run prod -- <command>, e.g. npm run prod -- node scripts/check-database.mjs"); process.exit(1); }
if (!existsSync(FILE)) { console.error(`Missing ${FILE}. Create it with the production ${REQUIRED.join(", ")} (one NAME=value per line).`); process.exit(1); }
const values = Object.fromEntries(readFileSync(FILE, "utf8").split(/\r?\n/)
  .map((line) => /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean)
  .map(([, name, value]) => [name, value.replace(/^(["'])(.*)\1$/, "$2")]));
const missing = REQUIRED.filter((name) => !values[name]);
if (missing.length) { console.error(`${FILE} is missing ${missing.join(", ")}.`); process.exit(1); }
// Every value must name the production project, so a staging value pasted here by mistake is caught.
const ref = (value) => /postgres\.([a-z0-9]+)[:@]/.exec(value)?.[1] ?? /(?:db\.)?([a-z0-9]{20})\.supabase\.co/.exec(value)?.[1] ?? "";
const wrong = ["DATABASE_URL", "DIRECT_DATABASE_URL", "SUPABASE_URL"].filter((name) => ref(values[name]) !== PRODUCTION_REF);
if (wrong.length) { console.error(`${FILE}: ${wrong.join(", ")} must point at production (${PRODUCTION_REF}).`); process.exit(1); }

console.log(`PRODUCTION (${PRODUCTION_REF}): ${command.join(" ")}\n`);
const env = { ...process.env, ...values };
// node runs directly so its arguments keep their quoting; npm and npx need a shell on Windows, so an argument with a
// space or shell character is quoted again (a file name such as "2026 DATABASE (NS + COLL).xlsx" stays one argument).
const quote = (arg) => (/^[\w@%+=:,./\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '\\"')}"`);
const result = command[0] === "node"
  ? spawnSync(process.execPath, command.slice(1), { stdio: "inherit", env })
  : spawnSync(command.map(quote).join(" "), { stdio: "inherit", shell: true, env });
process.exit(result.status ?? 1);

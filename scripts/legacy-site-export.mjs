/**
 * Exports the old Dayong web app (dayong.gissolve.com) to CSV files, since it has no export and we have no database
 * access. Run scripts/legacy-site-survey.mjs first to check the sign-in; this script uses the same .env.legacy-site.
 *
 *   node scripts/legacy-site-export.mjs            # lists, then every member, New Sale and collection record
 *   node scripts/legacy-site-export.mjs --lists    # lists only (minutes)
 *   node scripts/legacy-site-export.mjs --reuse    # parse list pages already saved, do not download them again
 *   node scripts/legacy-site-export.mjs --reuse --limit=3   # trial: only 3 new records of each kind
 *
 * How it reads the site (found with the survey, October 6, 2026): every list page holds all its rows, and each
 * record's edit form (/members/edit/{id}, /new-sales/edit/{id}, /entries/edit/{id}) holds its full details. Opening
 * an edit form saves nothing; this script never submits a form. GET requests only, one per second by default
 * (--delay=ms). The detail step can be stopped and run again: records already fetched are skipped.
 *
 * Output in legacy-data/export/ (git ignores it): one CSV per list and members.csv, new_sales.csv, collections.csv
 * with list columns plus details. It prints only counts, never a member's details. The files contain personal data:
 * keep them on this PC and delete legacy-data/ when the import is done.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BASE = "https://dayong.gissolve.com";
const OUT = "legacy-data/export", PAGES = path.join(OUT, "pages"), DETAILS = path.join(OUT, "details");
const args = process.argv.slice(2);
const DELAY = Number(args.find((arg) => arg.startsWith("--delay="))?.split("=")[1] ?? 1000);
const LISTS_ONLY = args.includes("--lists"), REUSE = args.includes("--reuse");
const LIMIT = Number(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1] ?? Infinity); // a trial run: at most this many new records per kind

/** List pages: file name → path. The survey found these; each holds all of its rows. */
const LISTS = { members: "/members", new_sales: "/new-sales", entries: "/entries", expenses: "/expenses", branches: "/branch", programs: "/program",
  users: "/user-accounts", attendance: "/attendance", audit: "/audit", reports: "/reports", fidelity: "/fidelity", matrix: "/matrix" };
/** Records whose edit form is fetched (the record ID comes from the row's View button). */
const DETAIL = { members: ["/members/edit/"], new_sales: ["/new-sales/edit/"], entries: ["/entries/edit/"] };

// ---------------------------------------------------------------- session
const env = fs.existsSync(".env.legacy-site") ? Object.fromEntries(fs.readFileSync(".env.legacy-site", "utf8").split(/\r?\n/)
  .map((line) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(([, name, value]) => [name, value.replace(/^(["'])(.*)\1$/, "$2")])) : {};
const cookies = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(url, options = {}) {
  const response = await fetch(new URL(url, BASE), { redirect: "manual", ...options, headers: { "User-Agent": "Mozilla/5.0 (data export by the account owner)", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...options.headers } });
  for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"); const at = pair.indexOf("="); cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim()); }
  return response;
}
async function signIn() {
  if (!env.LEGACY_SITE_USERNAME || !env.LEGACY_SITE_PASSWORD) throw new Error("Create .env.legacy-site with LEGACY_SITE_USERNAME and LEGACY_SITE_PASSWORD.");
  cookies.clear();
  const html = await (await request("/")).text();
  const token = /name="_token"\s+value="([^"]+)"/.exec(html)?.[1];
  if (!token) throw new Error("No sign-in form on the old site.");
  const response = await request("/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "X-XSRF-TOKEN": decodeURIComponent(cookies.get("XSRF-TOKEN") ?? "") },
    body: new URLSearchParams({ _token: token, username: env.LEGACY_SITE_USERNAME, password: env.LEGACY_SITE_PASSWORD }) });
  const landing = new URL(response.headers.get("location") ?? "/login", BASE).pathname;
  if (response.status !== 302 || landing === "/login") throw new Error("Sign-in failed: check .env.legacy-site.");
}
/** GET a page as text; signs in again once if the session ran out (redirect to /login). */
async function getText(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await request(url);
    const location = response.headers.get("location") ?? "";
    if (response.status === 302 && new URL(location, BASE).pathname === "/login") { await response.arrayBuffer(); await signIn(); continue; }
    if (response.status >= 500 || response.status === 429) { await response.arrayBuffer(); await wait(5000 * (attempt + 1)); continue; }
    return { status: response.status, html: await response.text() };
  }
  return { status: 0, html: "" };
}
async function download(url, file) {
  const response = await request(url);
  if (response.status !== 200) throw new Error(`${url}: status ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
}

// ---------------------------------------------------------------- parsing
const decode = (text) => text.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
const textOf = (html) => decode(html.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag, name) => { const match = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i").exec(tag); return match ? decode(match[2] ?? match[3]) : undefined; };

/** Reads a saved list page with runs of whitespace collapsed while streaming: the pages are over 95% blank space. */
async function compact(file) {
  let result = "";
  for await (const chunk of fs.createReadStream(file, { encoding: "utf8", highWaterMark: 8 * 1024 * 1024 })) result += chunk.replace(/\s+/g, " ");
  return result.replace(/ {2,}/g, " ");
}

/** Every table on a list page: headings, and per row its record ID (from the row's buttons), data-* attributes and cells. */
function listTables(html) {
  return [...html.matchAll(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi)].map(([, tableAttrs, inner]) => {
    const headings = [...(/<thead[\s\S]*?<\/thead>/i.exec(inner)?.[0] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((match) => textOf(match[1]));
    // Some pages never close <tbody>, so the body runs to </tbody> or the end of the table.
    const body = /<tbody[\s\S]*?(?:<\/tbody>|$)/i.exec(inner)?.[0] ?? "";
    const rows = [...body.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)].map(([, trAttrs, cells]) => ({
      id: /\w+\((\d+)[,)]/.exec(cells)?.[1] ?? "",
      data: Object.fromEntries([...trAttrs.matchAll(/\sdata-([\w-]+)\s*=\s*"([^"]*)"/g)].map(([, name, value]) => [name, decode(value)])),
      cells: [...cells.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => textOf(match[1])),
    })).filter((row) => row.cells.length > 1);
    return { id: attr(`<x${tableAttrs}>`, "id") ?? "", headings, rows };
  }).filter((table) => table.headings.length);
}

/** One list table as records: skips the checkbox and Action(s) columns, names blank or repeated headings. */
function tableRecords(table) {
  const used = new Map();
  const names = table.headings.map((heading, index) => {
    const base = heading.replace(/[^A-Za-z0-9#]+/g, " ").trim() || (index === 0 ? "" : `Column ${index + 1}`);
    const count = (used.get(base) ?? 0) + 1; used.set(base, count);
    return count > 1 ? `${base} ${count}` : base;
  });
  return table.rows.map((row) => {
    const record = { record_id: row.id };
    names.forEach((name, index) => { if (name && name !== "#" && !/^actions?$/i.test(name)) record[name] = row.cells[index] ?? ""; });
    for (const [name, value] of Object.entries(row.data)) record[`data_${name.replace(/-/g, "_")}`] = value;
    return record;
  });
}

/** An edit form's fields: inputs and textareas by name; a select gives its chosen option's text (and value as name_value). */
function formFields(html) {
  const fields = {};
  for (const [tag] of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attr(tag, "name"), type = (attr(tag, "type") ?? "text").toLowerCase();
    if (!name || name === "_token" || name === "_method" || ["submit", "button", "password", "file"].includes(type)) continue;
    if (["checkbox", "radio"].includes(type)) { if (/\schecked\b/i.test(tag)) fields[name] = attr(tag, "value") ?? "on"; else fields[name] ??= ""; continue; }
    fields[name] = attr(tag, "value") ?? "";
  }
  for (const [, tag, inner] of html.matchAll(/<textarea\b([^>]*)>([\s\S]*?)<\/textarea>/gi)) { const name = attr(`<x${tag}>`, "name"); if (name) fields[name] = decode(inner).trim(); }
  for (const [, tag, inner] of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)) {
    const name = attr(`<x${tag}>`, "name"); if (!name) continue;
    const options = [...inner.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map(([, optionAttrs, label]) => ({ value: attr(`<x${optionAttrs}>`, "value") ?? "", label: textOf(label), selected: /\sselected\b/i.test(optionAttrs) }));
    const wanted = attr(`<x${tag}>`, "value");
    // The chosen option is marked selected; else the form lists only the current one; else the select names its value.
    const chosen = options.find((option) => option.selected) ?? (options.length === 1 ? options[0] : options.find((option) => wanted && option.value === wanted));
    fields[name] = chosen?.label ?? ""; fields[`${name}_value`] = chosen?.value ?? wanted ?? "";
  }
  return fields;
}

/** The Beneficiaries section of a member's edit form, as a list of rows (table cells, or the fields of each group). */
function beneficiaries(html) {
  const at = html.search(/<legend[^>]*>\s*Beneficiaries\s*</i);
  if (at < 0) return [];
  const section = html.slice(at, html.indexOf("</fieldset>", at));
  if (/No beneficiaries found/i.test(section)) return [];
  const tableRows = [...section.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) => [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => textOf(cell[1]))).filter((cells) => cells.length);
  if (tableRows.length) return tableRows;
  const fields = formFields(section);
  return Object.keys(fields).length ? [fields] : [textOf(section.replace(/<legend[\s\S]*?<\/legend>/i, ""))].filter(Boolean);
}

// ---------------------------------------------------------------- CSV
const csvCell = (value) => { const text = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text; };
function writeCsv(file, records) {
  const columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  // Excel opens UTF-8 correctly (ñ, é) only with the byte order mark.
  fs.writeFileSync(file, `﻿${[columns.map(csvCell).join(","), ...records.map((record) => columns.map((column) => csvCell(record[column])).join(","))].join("\r\n")}\r\n`);
  return records.length;
}

// ---------------------------------------------------------------- run
fs.mkdirSync(PAGES, { recursive: true }); fs.mkdirSync(DETAILS, { recursive: true });
await signIn();
console.log("Signed in to the old site.\n\nLists:");
const listRecords = {};
for (const [name, url] of Object.entries(LISTS)) {
  let file = path.join(PAGES, `${name}.html`);
  // --reuse also accepts the pages the survey saved (legacy-data/site/new_sales.html for /new-sales).
  const surveyed = path.join("legacy-data/site", `${url.slice(1).replace(/[^a-z0-9]+/gi, "_")}.html`);
  if (REUSE && !fs.existsSync(file) && fs.existsSync(surveyed)) file = surveyed;
  else if (!(REUSE && fs.existsSync(file))) { await wait(DELAY); await download(url, file); }
  // Empty tables (popups, filters) are left out; a page with two lists (Cashflow: remittances and expenses) gives one CSV each.
  const all = listTables(await compact(file)), filled = all.filter((table) => table.rows.length), tables = filled.length ? filled : all.slice(0, 1);
  for (const [index, table] of tables.entries()) {
    const key = tables.length > 1 ? `${name}_${table.id.replace(/Table$/i, "").replace(/[^a-z0-9]+/gi, "_").toLowerCase() || index + 1}` : name;
    listRecords[key] = tableRecords(table);
    if (!DETAIL[key]) console.log(`  ${key}.csv: ${writeCsv(path.join(OUT, `${key}.csv`), listRecords[key])} rows`);
  }
}

for (const [key, [editPath]] of Object.entries(DETAIL)) {
  const rows = listRecords[key] ?? [];
  const store = path.join(DETAILS, `${key}.jsonl`);
  const done = new Map(fs.existsSync(store) ? fs.readFileSync(store, "utf8").split("\n").filter(Boolean).map((line) => { const record = JSON.parse(line); return [record.record_id, record]; }) : []);
  const ids = [...new Set(rows.map((row) => row.record_id).filter(Boolean))];
  if (!LISTS_ONLY) {
    const todo = ids.filter((id) => !done.has(id)).slice(0, LIMIT);
    console.log(`\n${key}: ${ids.length} records, ${done.size} already fetched, ${todo.length} to fetch (about ${Math.ceil((todo.length * (DELAY + 400)) / 60000)} min)`);
    let failed = 0;
    for (const [index, id] of todo.entries()) {
      await wait(DELAY);
      const { status, html } = await getText(`${editPath}${id}`);
      if (status !== 200) { failed++; continue; }
      const record = { record_id: id, ...formFields(html) };
      if (key === "members") record.beneficiaries = beneficiaries(html);
      fs.appendFileSync(store, `${JSON.stringify(record)}\n`); done.set(id, record);
      if ((index + 1) % 100 === 0) console.log(`  ${index + 1} of ${todo.length}`);
    }
    if (failed) console.log(`  ${failed} could not be read; run the script again to retry them.`);
  }
  // List columns first, then the form's details (prefixed form_ where a name repeats a list column).
  const merged = rows.map((row) => {
    const details = done.get(row.record_id) ?? {};
    return { ...row, ...Object.fromEntries(Object.entries(details).filter(([name]) => name !== "record_id").map(([name, value]) => [name in row ? `form_${name}` : name, value])) };
  });
  const file = key === "entries" ? "collections" : key;
  const withDetails = merged.filter((record) => done.has(record.record_id)).length;
  const extra = key === "members" ? ` · ${merged.filter((record) => record.beneficiaries?.length).length} with beneficiaries` : "";
  console.log(`  ${file}.csv: ${writeCsv(path.join(OUT, `${file}.csv`), merged)} rows, ${withDetails} with details${extra}`);
}
console.log(`\nDone. Files in ${OUT}/ hold personal data: keep them on this PC.`);

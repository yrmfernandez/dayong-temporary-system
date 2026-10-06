/**
 * Read-only survey of the old Dayong web app (dayong.gissolve.com), the first step to exporting its data, since it
 * has no export and we have no database access. Signs in with your own account, opens the pages linked from the
 * menu, saves each page under legacy-data/site/ (git ignores it), and prints only the STRUCTURE: page titles, table
 * column headings, row counts, how paging works, and link patterns. It never prints a member's details.
 *
 * Put the login in .env.legacy-site (git ignores .env* files; never paste it into chat):
 *   LEGACY_SITE_USERNAME=...
 *   LEGACY_SITE_PASSWORD=...
 *
 *   node scripts/legacy-site-survey.mjs              # menu pages
 *   node scripts/legacy-site-survey.mjs /members     # also these paths
 *
 * Only GET requests after sign-in, one per second, and never a link that could change data (delete, update, ...).
 * The saved files contain personal data: delete legacy-data/site/ when the export is done.
 */
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BASE = "https://dayong.gissolve.com";
const OUT = "legacy-data/site";
const MAX_PAGES = 60;
const UNSAFE = /logout|destroy|delete|remove|update|endorse|approve|reject|store|create|edit|reset|status|import|upload|password|check-|validate/i;

const env = fs.existsSync(".env.legacy-site") ? Object.fromEntries(fs.readFileSync(".env.legacy-site", "utf8").split(/\r?\n/)
  .map((line) => /^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/.exec(line)).filter(Boolean).map(([, name, value]) => [name, value.replace(/^(["'])(.*)\1$/, "$2")])) : {};
const username = env.LEGACY_SITE_USERNAME, password = env.LEGACY_SITE_PASSWORD;
if (!username || !password) { console.error("Create .env.legacy-site with LEGACY_SITE_USERNAME and LEGACY_SITE_PASSWORD (one per line)."); process.exit(1); }

const cookies = new Map();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function request(url, options = {}) {
  const response = await fetch(new URL(url, BASE), { redirect: "manual", ...options, headers: { "User-Agent": "Mozilla/5.0 (data export by the account owner)", Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...options.headers } });
  for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"); const at = pair.indexOf("="); cookies.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim()); }
  return response;
}
/** GET, following redirects by hand so cookies are kept. Returns the final URL and HTML. */
async function get(url) {
  let current = new URL(url, BASE).href;
  for (let hop = 0; hop < 5; hop++) {
    const response = await request(current);
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { current = new URL(response.headers.get("location"), current).href; continue; }
    return { url: current, status: response.status, html: await response.text() };
  }
  throw new Error(`Too many redirects from ${url}`);
}
/**
 * GET straight to a file: some list pages hold every record and are larger than Node can keep as one string
 * (over 512 MB). Returns the final URL, status, size, and a sample of the HTML for the survey: the start (title, table
 * headings, forms), the end (scripts), all links and the number of table rows, counted while streaming.
 */
async function download(url, file) {
  let current = new URL(url, BASE).href;
  for (let hop = 0; hop < 5; hop++) {
    const response = await request(current);
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { current = new URL(response.headers.get("location"), current).href; continue; }
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(file));
    const size = fs.statSync(file).size;
    if (size <= 50 * 1024 * 1024) { const html = fs.readFileSync(file, "utf8"); return { url: current, status: response.status, size, html, rows: null }; }
    // Large page: scan in chunks, carrying a short tail so a tag split across chunks is still seen.
    let head = "", tail = "", carry = "", rows = 0; const hrefs = new Set();
    for await (const chunk of fs.createReadStream(file, { encoding: "utf8", highWaterMark: 4 * 1024 * 1024 })) {
      const text = carry + chunk;
      if (head.length < 400_000) head += chunk.slice(0, 400_000 - head.length);
      rows += (text.match(/<tr[\s>]/gi) ?? []).length; // 4 characters, so never whole inside the 3-character carry
      for (const match of text.matchAll(/href="([^"#]+)"/g)) if (hrefs.size < 200_000) hrefs.add(match[1]);
      carry = text.slice(-3); tail = (tail + chunk).slice(-3_000_000);
    }
    const html = `${head}
${[...hrefs].map((href) => `<a href="${href}"></a>`).join("")}
${tail}`;
    return { url: current, status: response.status, size, html, rows };
  }
  throw new Error(`Too many redirects from ${url}`);
}

const strip = (html) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const tokenOf = (html) => /name="_token"\s+value="([^"]+)"/.exec(html)?.[1] ?? "";
/** /members/1234/edit → /members/{n}/edit, so link patterns can be counted without listing records. */
const pattern = (href) => { const url = new URL(href, BASE); return url.pathname.replace(/\/\d+(?=\/|$)/g, "/{n}").replace(/\/[0-9a-f-]{20,}(?=\/|$)/gi, "/{id}") + (url.search ? `?${[...url.searchParams.keys()].map((key) => `${key}=…`).join("&")}` : ""); };
const internalLinks = (html, from) => [...html.matchAll(/href="([^"#]+)"/g)].map((match) => { try { return new URL(match[1].replace(/&amp;/g, "&"), from); } catch { return null; } })
  .filter((url) => url && url.origin === BASE && !/\.(css|js|ico|png|jpe?g|svg|gif|woff2?|pdf)$/i.test(url.pathname));

function describe(html) {
  const tables = [...html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].map((match) => {
    const head = /<thead[\s\S]*?<\/thead>/i.exec(match[1])?.[0] ?? "";
    const body = /<tbody[\s\S]*?<\/tbody>/i.exec(match[1])?.[0] ?? match[1];
    const headings = [...head.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((th) => strip(th[1]));
    const rows = [...body.matchAll(/<tr\b/gi)].length;
    return { id: /id="([^"]+)"/.exec(match[0])?.[1] ?? "", headings, rows };
  });
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]).join("\n");
  return {
    title: strip(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
    tables,
    dataTables: /\.DataTable\(|\.dataTable\(/.test(scripts),
    serverSide: /serverSide\s*:\s*true/.test(scripts),
    ajax: [...scripts.matchAll(/(?:url|ajax)\s*:\s*["'`]([^"'`]+)["'`]/g)].map((match) => match[1]).filter((url) => !UNSAFE.test(url)),
    exportButtons: [...scripts.matchAll(/extend\s*:\s*["'](\w+)["']/g)].map((match) => match[1]),
    showing: /Showing\s+\d[\d,]*\s+to\s+\d[\d,]*\s+of\s+\d[\d,]*\s+\w+/i.exec(strip(html))?.[0] ?? "",
    getForms: [...html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].filter((form) => !/method="post"/i.test(form[1]))
      .map((form) => ({ action: /action="([^"]*)"/.exec(form[1])?.[1] ?? "", fields: [...form[2].matchAll(/<(?:input|select)\b[^>]*name="([^"]+)"/gi)].map((field) => field[1]).filter((name) => name !== "_token") })),
  };
}

// ---------------------------------------------------------------- sign in
const login = await get("/");
const token = tokenOf(login.html);
if (!token) { console.error(`No sign-in form at ${login.url} (status ${login.status}).`); process.exit(1); }
const xsrf = decodeURIComponent(cookies.get("XSRF-TOKEN") ?? "");
const posted = await request("/login", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: login.url, "X-XSRF-TOKEN": xsrf }, body: new URLSearchParams({ _token: token, username, password }) });
const landing = await get(posted.headers.get("location") ?? "/");
if (/name="password"/.test(landing.html) && /action="[^"]*\/login"/.test(landing.html)) { console.error("Sign-in failed: check the username and password in .env.legacy-site."); process.exit(1); }
console.log(`Signed in. Landing page: ${new URL(landing.url).pathname}\n`);

// ---------------------------------------------------------------- survey
fs.mkdirSync(OUT, { recursive: true });
const queue = [...new Set([landing.url, ...internalLinks(landing.html, landing.url).map((url) => url.href), ...process.argv.slice(2).map((p) => new URL(p, BASE).href)])];
const seen = new Set(), report = [];
while (queue.length && seen.size < MAX_PAGES) {
  const url = queue.shift();
  const key = pattern(url);
  if (seen.has(key) || UNSAFE.test(new URL(url).pathname)) continue;
  seen.add(key);
  await wait(1000);
  const file = path.join(OUT, `${key.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home"}.html`);
  process.stdout.write(`${key} … `);
  let page;
  if (url === landing.url) { page = { ...landing, size: landing.html.length, rows: null }; fs.writeFileSync(file, landing.html); }
  else page = await download(url, file);
  const info = describe(page.html);
  // A large page's sample cuts the table, so its row count comes from the streaming count instead.
  if (page.rows !== null && info.tables.length) info.tables = [{ ...info.tables.reduce((a, b) => (a.headings.length >= b.headings.length ? a : b)), rows: page.rows }];
  else if (page.rows !== null) info.tables = [{ id: "", headings: [...(/<thead[\s\S]*?<\/thead>/i.exec(page.html)?.[0] ?? "").matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((th) => strip(th[1])), rows: page.rows }];
  const links = internalLinks(page.html, page.url);
  // Follow menu-level pages (no record IDs) so the survey stays small; record pages are only counted.
  for (const link of links) if (!/\/\d+(\/|$)/.test(link.pathname) && !link.search) queue.push(link.href);
  const linkPatterns = Object.entries(links.reduce((all, link) => ({ ...all, [pattern(link.href)]: (all[pattern(link.href)] ?? 0) + 1 }), {})).filter(([p]) => /\{n\}|\{id\}|\?/.test(p));
  report.push({ path: key, status: page.status, file, ...info, linkPatterns });
  console.log(`[${page.status}]  "${info.title}"  ${(page.size / 1024 / 1024).toFixed(1)} MB`);
  for (const table of info.tables) console.log(`   table${table.id ? ` #${table.id}` : ""}: ${table.rows} rows · columns: ${table.headings.join(" | ") || "(no headings)"}`);
  if (info.dataTables) console.log(`   DataTables${info.serverSide ? " (server-side paging)" : " (all rows in the page)"}${info.exportButtons.length ? ` · export buttons in code: ${info.exportButtons.join(", ")}` : ""}`);
  if (info.showing) console.log(`   ${info.showing}`);
  for (const url of info.ajax) console.log(`   data URL: ${url}`);
  for (const form of info.getForms) console.log(`   filter form → ${form.action || "(same page)"}: ${form.fields.join(", ")}`);
  for (const [p, n] of linkPatterns) console.log(`   links: ${p} ×${n}`);
}
fs.writeFileSync(path.join(OUT, "survey.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.length} pages surveyed. Structure: ${OUT}/survey.json (no member values). Saved pages in ${OUT}/ contain personal data; do not share them.`);

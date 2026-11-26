/**
 * Saves the two System Updates for Deceased Members (November 26, 2026) as DRAFTS: one for Entry Clerks, one for
 * Finance, Finance-Auditor and Administrators. Nobody sees a draft; IT or an Administrator previews it in System Updates
 * and presses Announce once the code is pushed (migrations 0057 and 0058 on production). Run again, a draft with the same
 * title that is still a draft takes this text; an announced one is kept as it is.
 *
 *   node scripts/save-deceased-updates.mjs                 (staging)
 *   npm run prod -- node scripts/save-deceased-updates.mjs (production)
 */
import nextEnv from "@next/env";
import crypto from "node:crypto";
import postgres from "postgres";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.DIRECT_DATABASE_URL;
if (!url) throw new Error("Missing DIRECT_DATABASE_URL.");
const project = /postgres\.([a-z0-9]+)[:@]/.exec(url)?.[1] ?? "unknown";

const updates = [
  {
    title: "New: Deceased Members, encode each deceased member",
    summary: "Deceased Members is a new page under Members in your menu. When a member dies, encode it there: the MAS, the member, the program, NOP and TMD, the date of death, the requirements handed in, the claims given or the services, the date of release, and attach the documents (photos or scans, PDF, Word, Excel), as many as needed. Finance or an Administrator then confirms your record, and only then is the member marked Deceased.",
    audience: ["entry clerk"],
    steps: [
      { text: "Open Deceased Members under Members in your menu and press Encode a deceased member.", path: "/deceased-members" },
      { text: "Choose the MAS (or Other MAS to type a name), then search the member in the list. Members whose account is already marked Deceased are listed too. If the person is not in the list, press Type the name instead.", path: "/deceased-members" },
      { text: "Choose the program (the member's programs are listed first), then type the NOP, the TMD and the date of death.", path: "/deceased-members" },
      { text: "Answer Convert to services: Yes or No. If Yes, choose Half glass, Full glass or Other, and type the amount of full payment.", path: "/deceased-members" },
      { text: "Tick the requirements handed in and the claims given. For anything not listed, tick Other and type it.", path: "/deceased-members" },
      { text: "Add the date of release and any remarks, then drop the files or press Choose files: the death certificate, IDs, receipts and the rest. Large photos are made smaller for you. Press Save record; the files are attached right after.", path: "/deceased-members" },
      { text: "Your record waits for Finance or an Administrator to confirm it. Once confirmed, the member you picked is marked Deceased with the date of death. A typed name changes no member, so pick the member from the list whenever they are there.", path: "/deceased-members" },
      { text: "If your record is rejected, the number beside Deceased Members tells you. Open the record, read the reason, press Fix and send again, correct it and save; it goes back for confirmation.", path: "/deceased-members" },
      { text: "Your records are listed below the form. Each shows how many requirements are still missing; open it to see everything and the files. Press Edit to add requirements or files later. A confirmed record keeps its member and date of death; before it is confirmed you can Remove it (with the reason) if it was encoded by mistake.", path: "/deceased-members" },
    ],
  },
  {
    title: "New: Deceased Members encoded by the Entry Clerks",
    summary: "Deceased Members is a new page in your menu (Finance: Directory; Administrators: Master Data). It shows every deceased member the Entry Clerks encode: program, NOP, TMD, date of death, requirements handed in and still missing, claims given or services and full payment, date of release, remarks and the attached documents. You confirm or reject each record; confirming marks the member Deceased. You can filter and download it as CSV.",
    audience: ["finance", "finance-auditor", "administrator"],
    steps: [
      { text: "Open Deceased Members in your menu. The number beside it is how many records wait for your confirmation; click the Waiting for confirmation tile to list them.", path: "/deceased-members" },
      { text: "Click a record to open it: every field, the requirements with the missing ones, the claims, remarks, and the files. Click a file to open it, or the download icon to save it.", path: "/deceased-members" },
      { text: "Check the documents, then press Confirm. The member picked on the record is marked Deceased with the date of death: their open accounts stop taking payments and leave MAM. If something is wrong, press Reject and say what the clerk should fix. A record you encoded yourself is confirmed by someone else.", path: "/deceased-members" },
      { text: "Confirmed by mistake? Open the record and press Reopen with the reason: the member's status goes back to what it was and the record waits for confirmation again.", path: "/deceased-members" },
      { text: "Filter by branch, clerk, claims or services, requirements missing, or the date of death range, or search a name. Click Requirements missing at the top to see the records still lacking a document.", path: "/deceased-members" },
      { text: "Tick Show removed to see records a clerk removed and why. Press CSV to save what is shown.", path: "/deceased-members" },
    ],
  },
];

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  console.log(`Supabase project: ${project}`);
  const now = new Date().toISOString();
  for (const update of updates) {
    const [existing] = await sql`select update_id, status from system_updates where title = ${update.title} limit 1`;
    // A draft not yet announced takes the latest text (the confirmation step was added later the same day); an announced one is kept.
    if (existing?.status === "Draft") {
      await sql`update system_updates set summary = ${update.summary}, steps = ${sql.json(update.steps)}, audience = ${sql.json(update.audience)}, updated_at = ${now} where update_id = ${existing.update_id}`;
      console.log(`Updated draft: ${existing.update_id} ${update.title}`); continue;
    }
    if (existing) { console.log(`Kept: ${existing.update_id} (${existing.status}) ${update.title}`); continue; }
    const stamp = now.replace(/\D/g, "").slice(0, 14), id = `UPD-${stamp}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
    await sql`insert into system_updates (update_id, title, summary, steps, audience, status, created_at, updated_at, encoded_by_name, encoded_at)
      values (${id}, ${update.title}, ${update.summary}, ${sql.json(update.steps)}, ${sql.json(update.audience)}, 'Draft', ${now}, ${now}, 'System (script)', ${now})`;
    console.log(`Saved draft: ${id} for ${update.audience.join(", ")}: ${update.title}`);
  }
  console.log("Announce them in System Updates once the code is pushed (migrations 0057 and 0058 on production).");
} finally {
  await sql.end();
}

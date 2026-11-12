import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import { canAccessPath, canManageConfigurationFor, type AccessContext } from "@/lib/access-control";
import { currentDb, encodedBy, inTransaction, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/**
 * System Updates (owner, November 12, 2026). IT (and Administrators) write what changed in the system: a title, the
 * short text of the pop-up, and steps that each say what to do and open the page where it happens. Announcing it shows
 * everyone it is for (every role, or the roles chosen) a pop-up once: it cannot be closed for 5 seconds, and
 * "Go to updates" opens it on /updates as a step-by-step guide with a "Take me there" button per step.
 */
export type UpdateStep = { text: string; path: string };
export type SystemUpdate = {
  id: string; title: string; summary: string; steps: UpdateStep[]; audience: string[];
  status: "Draft" | "Announced"; announcedAt: string; announcedBy: string; createdBy: string; updatedAt: string;
};
export const UPDATE_TITLE_MAX = 120, UPDATE_SUMMARY_MAX = 600, UPDATE_STEP_MAX = 400, UPDATE_STEPS_MAX = 12;
/** A new user sees the pop-up of updates announced in the last 30 days only, not every past one. */
const POPUP_DAYS = 30;

const text = (value: unknown) => String(value ?? "").trim();
const role = (value: unknown) => text(value).toLowerCase();

function readUpdate(row: typeof schema.system_updates.$inferSelect): SystemUpdate {
  const steps = Array.isArray(row.steps) ? row.steps as Array<Partial<UpdateStep>> : [];
  return {
    id: row.update_id, title: text(row.title), summary: text(row.summary),
    steps: steps.map((step) => ({ text: text(step.text), path: text(step.path) })).filter((step) => step.text),
    audience: Array.isArray(row.audience) ? (row.audience as unknown[]).map(role).filter(Boolean) : [],
    status: text(row.status) === "Announced" ? "Announced" : "Draft",
    announcedAt: text(row.announced_at), announcedBy: text(row.announced_by_name), createdBy: text(row.encoded_by_name), updatedAt: text(row.updated_at),
  };
}

/** Whether the update is for this user: everyone, or one of their roles (all of them, whatever workspace is open). */
export const isForUser = (update: Pick<SystemUpdate, "audience">, roleNames: string[]) =>
  !update.audience.length || roleNames.some((name) => update.audience.includes(role(name)));

export const canManageUpdatesFor = (user: AccessContext) => canManageConfigurationFor(user);

/** The announced updates for this user, newest first, each step saying whether they may open its page. */
export async function updatesForUser(user: AccessContext & { userId: string }) {
  const rows = await currentDb().select().from(schema.system_updates).where(eq(schema.system_updates.status, "Announced")).orderBy(desc(schema.system_updates.announced_at)).limit(200);
  const updates = rows.map(readUpdate).filter((update) => isForUser(update, user.roleNames));
  const seen = updates.length ? await currentDb().select({ id: schema.system_update_views.update_id }).from(schema.system_update_views)
    .where(and(eq(schema.system_update_views.user_id, user.userId), inArray(schema.system_update_views.update_id, updates.map((update) => update.id)))) : [];
  const seenIds = new Set(seen.map((row) => row.id));
  return updates.map((update) => ({ ...update, seen: seenIds.has(update.id), steps: update.steps.map((step) => ({ ...step, canOpen: Boolean(step.path) && canAccessPath(user, step.path) })) }));
}

/** Every update (drafts too) for IT, with how many users have seen each announced one. */
export async function allUpdates() {
  const rows = await currentDb().select().from(schema.system_updates).orderBy(desc(schema.system_updates.row_seq)).limit(200);
  const counts = await currentDb().select({ id: schema.system_update_views.update_id, seen: sql<number>`count(*)::int` }).from(schema.system_update_views).groupBy(schema.system_update_views.update_id);
  const seen = new Map(counts.map((row) => [row.id, Number(row.seen)]));
  return rows.map(readUpdate).map((update) => ({ ...update, seenCount: seen.get(update.id) ?? 0 }));
}

/** The oldest announced update (last 30 days) this user has not seen yet, for the pop-up; null when none. */
export async function nextUnseenUpdate(user: { userId: string; roleNames: string[] }) {
  const since = new Date(Date.now() - POPUP_DAYS * 86_400_000).toISOString();
  const rows = await currentDb().select().from(schema.system_updates)
    .where(and(eq(schema.system_updates.status, "Announced"), gte(schema.system_updates.announced_at, since),
      sql`not exists (select 1 from system_update_views v where v.update_id = ${schema.system_updates.update_id} and v.user_id = ${user.userId})`))
    .orderBy(schema.system_updates.announced_at).limit(20);
  const update = rows.map(readUpdate).find((item) => isForUser(item, user.roleNames));
  return update ? { id: update.id, title: update.title, summary: update.summary, steps: update.steps.length, announcedAt: update.announcedAt, announcedBy: update.announcedBy } : null;
}

/** Checks and tidies what IT typed. */
function cleanInput(input: { title?: unknown; summary?: unknown; steps?: unknown; audience?: unknown }) {
  const title = text(input.title), summary = text(input.summary);
  if (title.length < 3) throw new Error("Give the update a title.");
  if (title.length > UPDATE_TITLE_MAX) throw new Error(`Keep the title to ${UPDATE_TITLE_MAX} characters.`);
  if (summary.length < 3) throw new Error("Write the short message of the pop-up.");
  if (summary.length > UPDATE_SUMMARY_MAX) throw new Error(`Keep the pop-up message to ${UPDATE_SUMMARY_MAX} characters.`);
  const steps = (Array.isArray(input.steps) ? input.steps as Array<Record<string, unknown>> : [])
    .map((step) => ({ text: text(step?.text), path: text(step?.path) }))
    .filter((step) => step.text);
  if (steps.length > UPDATE_STEPS_MAX) throw new Error(`Keep it to ${UPDATE_STEPS_MAX} steps.`);
  if (steps.some((step) => step.text.length > UPDATE_STEP_MAX)) throw new Error(`Keep each step to ${UPDATE_STEP_MAX} characters.`);
  if (steps.some((step) => step.path && !/^\/[a-z0-9\-/]*$/.test(step.path))) throw new Error("A step's page must be one of the system's pages.");
  const audience = [...new Set((Array.isArray(input.audience) ? input.audience : []).map(role).filter(Boolean))];
  return { title, summary, steps, audience };
}

async function findUpdate(id: string) {
  const [row] = await currentDb().select().from(schema.system_updates).where(eq(schema.system_updates.update_id, text(id))).limit(1);
  if (!row) throw new Error("This update no longer exists.");
  return readUpdate(row);
}

/** IT saves a new update (a draft), or changes one. Changing an announced one does not show its pop-up again. */
export async function saveUpdate(input: { id?: unknown; title?: unknown; summary?: unknown; steps?: unknown; audience?: unknown }) {
  const clean = cleanInput(input), now = new Date().toISOString(), id = text(input.id);
  if (id) {
    await findUpdate(id);
    await currentDb().update(schema.system_updates).set({ ...clean, updated_at: now }).where(eq(schema.system_updates.update_id, id));
    return findUpdate(id);
  }
  const newId = createReadableId("UPD");
  await currentDb().insert(schema.system_updates).values({ update_id: newId, ...clean, status: "Draft", created_at: now, updated_at: now, ...encodedBy() });
  return findUpdate(newId);
}

/** IT announces a draft (everyone it is for gets the pop-up) or takes an announced one back to a draft. */
export async function setAnnounced(id: string, announce: boolean, by: string) {
  const update = await findUpdate(id), now = new Date().toISOString();
  if (announce && update.status === "Announced") throw new Error("This update is already announced.");
  if (!announce && update.status === "Draft") throw new Error("This update is not announced.");
  await currentDb().update(schema.system_updates).set(announce
    ? { status: "Announced", announced_at: now, announced_by_name: by, updated_at: now }
    : { status: "Draft", updated_at: now }).where(eq(schema.system_updates.update_id, update.id));
  return findUpdate(update.id);
}

/** IT deletes a draft; an announced update is taken back to a draft first. */
export async function deleteUpdate(id: string) {
  const update = await findUpdate(id);
  if (update.status === "Announced") throw new Error("Take the update back to a draft before deleting it.");
  await currentDb().delete(schema.system_updates).where(eq(schema.system_updates.update_id, update.id));
}

/** The user closed the pop-up (`opened` false) or opened the update on /updates (`opened` true). */
export async function markUpdateSeen(userId: string, id: string, opened: boolean) {
  const now = new Date().toISOString();
  await inTransaction(async (tx) => {
    await tx.insert(schema.system_update_views).values({ update_id: text(id), user_id: text(userId), seen_at: now, opened_at: opened ? now : null })
      .onConflictDoUpdate({ target: [schema.system_update_views.update_id, schema.system_update_views.user_id], set: opened ? { opened_at: now } : { seen_at: sql`coalesce(${schema.system_update_views.seen_at}, ${now})` } });
  });
}

/** The roles an update can be for, from Roles. */
export async function updateRoleChoices() {
  const rows = await currentDb().select({ name: schema.roles.role_name, status: schema.roles.status }).from(schema.roles);
  return [...new Set(rows.filter((row) => text(row.status).toLowerCase() !== "inactive").map((row) => text(row.name)).filter(Boolean))].sort();
}

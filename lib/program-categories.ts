import { asc, eq, sql } from "drizzle-orm";

import { currentDb, encodedBy, schema } from "@/lib/db";
import { createReadableId } from "@/lib/readable-id";

/*
 * Program categories (program_categories). A program holds its category_id, so a category can be renamed without
 * touching programs.
 */
const text = (value: unknown) => String(value ?? "").trim();
const categories = schema.program_categories;

export type ProgramCategory = { id: string; name: string; status: "active" | "inactive"; description: string };

export async function getProgramCategories(): Promise<ProgramCategory[]> {
  const rows = await currentDb().select().from(categories).orderBy(asc(categories.category_name));
  return rows.map((row) => ({
    id: row.category_id, name: row.category_name, status: (text(row.status).toLowerCase() === "inactive" ? "inactive" : "active") as ProgramCategory["status"],
    description: text(row.description),
  })).filter((category) => category.id && category.name);
}

function validName(name: string, list: ProgramCategory[], exceptId = "") {
  if (name.length < 2 || name.length > 60) throw new Error("A category name needs 2 to 60 characters.");
  if (list.some((category) => category.id !== exceptId && category.name.toLowerCase() === name.toLowerCase())) throw new Error(`A category named "${name}" already exists.`);
}

export async function createProgramCategory(input: { name: unknown; description?: unknown }) {
  const name = text(input.name), description = text(input.description);
  validName(name, await getProgramCategories());
  const id = createReadableId("CAT");
  await currentDb().insert(categories).values({ category_id: id, category_name: name, status: "active", description: description || null, ...encodedBy() });
  return { id };
}

export async function updateProgramCategory(id: string, input: { name: unknown; status?: unknown; description?: unknown }) {
  const list = await getProgramCategories();
  const category = list.find((item) => item.id === text(id));
  if (!category) throw new Error("Category not found.");
  const name = text(input.name);
  validName(name, list, category.id);
  const status = text(input.status) === "inactive" ? "inactive" : "active";
  await currentDb().update(categories).set({ category_name: name, status, description: text(input.description) || null }).where(eq(categories.category_id, category.id));
  return { id: category.id };
}

/** A category still used by a program is made inactive instead, so those programs keep their category. */
export async function deleteProgramCategory(id: string) {
  const db = currentDb();
  const [{ used }] = await db.select({ used: sql<number>`count(*)::int` }).from(schema.programs).where(eq(schema.programs.category_id, text(id)));
  if (used) throw new Error(`${used} program${used === 1 ? " uses" : "s use"} this category. Set it to inactive instead, or move those programs first.`);
  const removed = await db.delete(categories).where(eq(categories.category_id, text(id))).returning({ id: categories.category_id });
  if (!removed.length) throw new Error("Category not found.");
  return { id };
}

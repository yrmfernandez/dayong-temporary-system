import { appendEncodedRows } from "@/lib/encoder-sheets";
import { GOOGLE_SHEET_ID, sheets } from "@/lib/google-sheets";
import { createReadableId } from "@/lib/readable-id";
import { deleteRowsById } from "@/lib/sheet-rows";

/*
 * Program Categories (npm run sheets:program-categories): A category_id, B category_name, C status, D description,
 * then encoder identity. Programs!S holds a program's category_id, so a category can be renamed without touching programs.
 */
const SHEET = "'Program Categories'";
const text = (value: unknown) => String(value ?? "").trim();

export type ProgramCategory = { id: string; name: string; status: "active" | "inactive"; description: string; rowNumber: number };

export async function getProgramCategories(): Promise<ProgramCategory[]> {
  const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: `${SHEET}!A:D` })).data.values ?? [];
  return rows.slice(1).map((row, index) => ({
    id: text(row[0]), name: text(row[1]), status: (text(row[2]).toLowerCase() === "inactive" ? "inactive" : "active") as ProgramCategory["status"],
    description: text(row[3]), rowNumber: index + 2,
  })).filter((category) => category.id && category.name).sort((a, b) => a.name.localeCompare(b.name));
}

function validName(name: string, categories: ProgramCategory[], exceptId = "") {
  if (name.length < 2 || name.length > 60) throw new Error("A category name needs 2 to 60 characters.");
  if (categories.some((category) => category.id !== exceptId && category.name.toLowerCase() === name.toLowerCase())) throw new Error(`A category named "${name}" already exists.`);
}

export async function createProgramCategory(input: { name: unknown; description?: unknown }) {
  const name = text(input.name), description = text(input.description);
  validName(name, await getProgramCategories());
  const id = createReadableId("CAT");
  await appendEncodedRows({ range: `${SHEET}!A:D`, requestBody: { values: [[id, name, "active", description]] } });
  return { id };
}

export async function updateProgramCategory(id: string, input: { name: unknown; status?: unknown; description?: unknown }) {
  const categories = await getProgramCategories();
  const category = categories.find((item) => item.id === text(id));
  if (!category) throw new Error("Category not found.");
  const name = text(input.name);
  validName(name, categories, category.id);
  const status = text(input.status) === "inactive" ? "inactive" : "active";
  await sheets.spreadsheets.values.update({ spreadsheetId: GOOGLE_SHEET_ID, range: `${SHEET}!B${category.rowNumber}:D${category.rowNumber}`, valueInputOption: "RAW", requestBody: { values: [[name, status, text(input.description)]] } });
  return { id: category.id };
}

/** A category still used by a program is made inactive instead, so those programs keep their category. */
export async function deleteProgramCategory(id: string) {
  const programs = (await sheets.spreadsheets.values.get({ spreadsheetId: GOOGLE_SHEET_ID, range: "Programs!A:S" })).data.values ?? [];
  const used = programs.slice(1).filter((row) => text(row[18]) === text(id)).length;
  if (used) throw new Error(`${used} program${used === 1 ? " uses" : "s use"} this category. Set it to inactive instead, or move those programs first.`);
  if (!(await deleteRowsById("Program Categories", [text(id)]))) throw new Error("Category not found.");
  return { id };
}

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { isMasFamilyRole } from "@/lib/access-control";
import { getDb, schema } from "@/lib/db";
import {
  DECEASED_CLAIMS, DECEASED_FILE_TYPES, DECEASED_REQUIREMENTS, DECEASED_SERVICES, MAX_DECEASED_FILE_BYTES, MAX_DECEASED_FILES,
  type DeceasedFile, type DeceasedRecord,
} from "@/lib/deceased-members-rules";
import { getEncoder } from "@/lib/encoder-context";
import { getEmployees } from "@/lib/employees";
import { getBranches, getPrograms } from "@/lib/google-sheets-data";
import { inventoryBranches } from "@/lib/inventory";
import { manilaToday } from "@/lib/manila-date";
import { readStoredFile, storePhoto } from "@/lib/photo-storage";
import { createReadableId } from "@/lib/readable-id";

/**
 * Deceased Members (owner, November 26, 2026: "for entry clerks, they encode the deceased members").
 *
 * - An Entry Clerk encodes a record for one of their branches (primary branch and the branches they clerk): branch, MAS,
 *   the deceased member or beneficiary, program, converted to services or not, NOP, total monthly deposit, date of
 *   death, the requirements handed in and the claims given (checklists with Other), the service and full payment when
 *   converted, date of release and remarks, and attaches any number of files.
 * - Only the clerk who encoded a record changes it; Administrators and Finance see every record (view only).
 * - The member can be picked from the branch and MAS list (any account status: a deceased member's account may already
 *   be marked Deceased) or the name typed. Encoding here does not change the member's account status.
 * - Removing a record keeps its row with the reason; a removed file keeps its stored file. The Audit Log has every
 *   change (attach_audit_triggers in migration 0057).
 */
export * from "@/lib/deceased-members-rules";

const { deceased_claims: claims, deceased_claim_files: files, member_programs: memberPrograms, members } = schema;
const text = (value: unknown) => String(value ?? "").trim();
const same = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const toFile = (row: typeof files.$inferSelect): DeceasedFile => ({ id: row.file_id, name: row.file_name, type: row.mime_type, size: row.size_bytes, uploadedAt: text(row.encoded_at), uploadedBy: text(row.encoded_by_name) });

const toRecord = (row: typeof claims.$inferSelect, attached: DeceasedFile[] = []): DeceasedRecord => ({
  id: row.claim_id, employeeId: row.employee_id, employeeName: text(row.employee_name), branch: row.branch,
  masEmployeeId: text(row.mas_employee_id), masName: text(row.mas_name), memberId: text(row.member_id), deceasedName: row.deceased_name,
  programId: text(row.program_id), programName: text(row.program_name), convertedToServices: row.converted_to_services,
  nop: row.nop, totalMonthlyDeposit: row.total_monthly_deposit === null ? null : Number(row.total_monthly_deposit), dateOfDeath: text(row.date_of_death),
  requirements: Array.isArray(row.requirements_json) ? row.requirements_json : [], requirementsOther: text(row.requirements_other),
  claims: Array.isArray(row.claims_json) ? row.claims_json : [], claimsOther: text(row.claims_other),
  service: text(row.service), serviceOther: text(row.service_other), fullPaymentAmount: row.full_payment_amount === null ? null : Number(row.full_payment_amount),
  dateOfRelease: text(row.date_of_release), remarks: text(row.remarks),
  status: row.status === "Removed" ? "Removed" : "Active", removedReason: text(row.removed_reason), removedAt: text(row.removed_at),
  addedAt: text(row.encoded_at), updatedAt: text(row.updated_at), files: attached,
});

function wholeNumber(value: unknown, label: string) {
  if (value === null || value === undefined || text(value) === "") return null;
  const number = Number(text(value).replace(/,/g, ""));
  if (!Number.isInteger(number) || number < 0 || number > 10_000) throw new Error(`${label} must be a whole number from 0.`);
  return number;
}

function amount(value: unknown, label: string) {
  const raw = text(value).replace(/,/g, "");
  if (!raw) return null;
  const number = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(number) || number < 0 || number > 99_999_999) throw new Error(`${label} must be an amount from 0.`);
  return number;
}

/** The ticked labels that belong to the list, in the list's order; "Other" needs its text. */
function checklist(value: unknown, allowed: readonly string[], other: unknown, label: string) {
  const ticked = Array.isArray(value) ? value.map(text) : [];
  const picked = allowed.filter((item) => ticked.some((tick) => same(tick, item)));
  const otherText = text(other).replace(/\s+/g, " ").slice(0, 200);
  if (ticked.some((tick) => same(tick, "Other")) && !otherText) throw new Error(`Type the other ${label}, or untick Other.`);
  return { picked, other: ticked.some((tick) => same(tick, "Other")) ? otherText : "" };
}

const yesNo = (value: unknown) => value === true || ["yes", "true", "1"].includes(text(value).toLowerCase()) ? true
  : value === false || ["no", "false", "0"].includes(text(value).toLowerCase()) ? false : null;

/** The branches a clerk encodes for (same as Inventory: primary branch and the branches they clerk). */
export const deceasedBranches = inventoryBranches;

/** For each of these branches, the MAS working there (active, MAS duty), by name; and every program. */
export async function deceasedFormOptions(branchNames: string[]) {
  const [employees, branches, programs] = await Promise.all([getEmployees(), getBranches(), getPrograms()]);
  const mas: Record<string, Array<{ id: string; name: string }>> = {};
  for (const name of branchNames) {
    const branch = branches.find((item) => same(item.name, name));
    mas[name] = employees
      .filter((employee) => employee.status === "active" && employee.roles.some(isMasFamilyRole) && ((branch && employee.masBranchIds.includes(branch.id)) || same(employee.branch, name)))
      .map((employee) => ({ id: employee.id, name: employee.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  const programList = programs.map((program) => ({ id: program.id, name: program.name, active: program.status === "active" }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
  return { mas, programs: programList };
}

/**
 * Members with an account under this branch and MAS, whatever the account's status (a deceased member's may already be
 * Deceased or Forfeited), with the programs of those accounts. For the member field; at most 2,000.
 */
export async function deceasedMemberChoices(branch: string, masName: string) {
  if (!text(branch) || !text(masName)) return [];
  const rows = await getDb().select({
    id: members.member_id, number: members.member_number, surname: members.surname, firstName: members.first_name, middleName: members.middle_name, extension: members.name_extension,
    programId: memberPrograms.program_id, status: memberPrograms.account_status,
  }).from(memberPrograms).innerJoin(members, eq(members.member_id, memberPrograms.member_id))
    .where(and(sql`lower(trim(${memberPrograms.branch})) = ${text(branch).toLowerCase()}`, sql`lower(trim(${memberPrograms.mas})) = ${text(masName).toLowerCase()}`))
    .orderBy(asc(members.surname), asc(members.first_name)).limit(5000);
  const byMember = new Map<string, { id: string; number: string; name: string; programIds: string[]; statuses: string[] }>();
  for (const row of rows) {
    const name = [`${text(row.surname)},`, text(row.firstName), text(row.middleName), text(row.extension)].filter(Boolean).join(" ").replace(/,$/, "");
    const entry = byMember.get(row.id) ?? { id: row.id, number: text(row.number), name, programIds: [], statuses: [] };
    if (!entry.programIds.includes(row.programId)) { entry.programIds.push(row.programId); entry.statuses.push(text(row.status)); }
    byMember.set(row.id, entry);
  }
  return [...byMember.values()].slice(0, 2000);
}

/** The fields of a record, checked. `own` gives the clerk's branches and the form options to check against. */
export async function deceasedFields(input: Record<string, unknown>, own: { names: string[]; primary: string }) {
  const branch = own.names.find((name) => same(name, input.branch)) ?? (text(input.branch) ? "" : own.primary);
  if (!branch) throw new Error(own.names.length ? "Choose one of your branches." : "You have no branch yet. Ask an administrator to set your branch in Employees.");
  const options = await deceasedFormOptions([branch]);

  const masName = text(input.masName).replace(/\s+/g, " ").slice(0, 120);
  if (!masName) throw new Error("Choose the MAS.");
  const mas = options.mas[branch].find((item) => item.id === text(input.masEmployeeId)) ?? options.mas[branch].find((item) => same(item.name, masName));

  const deceasedName = text(input.deceasedName).replace(/\s+/g, " ").slice(0, 160);
  if (deceasedName.length < 3) throw new Error("Type the name of the deceased member or beneficiary.");

  const program = options.programs.find((item) => item.id === text(input.programId));
  if (!program) throw new Error("Choose the program.");

  const converted = yesNo(input.convertedToServices);
  if (converted === null) throw new Error("Answer Convert to services: Yes or No.");

  const dateOfDeath = text(input.dateOfDeath);
  if (!isDate(dateOfDeath)) throw new Error("Enter the date of death.");
  if (dateOfDeath > manilaToday()) throw new Error("The date of death cannot be after today.");
  const dateOfRelease = text(input.dateOfRelease);
  if (dateOfRelease && !isDate(dateOfRelease)) throw new Error("The date of release is not a valid date.");
  if (dateOfRelease && dateOfRelease < dateOfDeath) throw new Error("The date of release cannot be before the date of death.");

  const requirements = checklist(input.requirements, DECEASED_REQUIREMENTS, input.requirementsOther, "requirement");
  const given = checklist(input.claims, DECEASED_CLAIMS, input.claimsOther, "claim");

  let service: string | null = null, serviceOther: string | null = null;
  if (converted) {
    service = DECEASED_SERVICES.find((item) => same(item, input.service)) ?? null;
    if (!service) throw new Error("Choose the service: Half glass, Full glass or Other.");
    serviceOther = service === "Other" ? text(input.serviceOther).replace(/\s+/g, " ").slice(0, 120) : null;
    if (service === "Other" && !serviceOther) throw new Error("Type the other service.");
  }

  return {
    branch, mas_employee_id: mas?.id ?? null, mas_name: mas?.name ?? masName,
    member_id: text(input.memberId).slice(0, 60) || null, deceased_name: deceasedName,
    program_id: program.id, program_name: program.name, converted_to_services: converted,
    nop: wholeNumber(input.nop, "Number of payments (NOP)"), total_monthly_deposit: amount(input.totalMonthlyDeposit, "Total monthly deposit (TMD)"),
    date_of_death: dateOfDeath,
    requirements_json: requirements.picked, requirements_other: requirements.other || null,
    claims_json: given.picked, claims_other: given.other || null,
    service, service_other: serviceOther,
    full_payment_amount: converted ? amount(input.fullPaymentAmount, "Amount of full payment") : null,
    date_of_release: dateOfRelease || null, remarks: text(input.remarks).slice(0, 1000) || null,
  } satisfies Partial<typeof claims.$inferInsert>;
}

async function filesFor(ids: string[]) {
  if (!ids.length) return new Map<string, DeceasedFile[]>();
  const rows = await getDb().select().from(files).where(and(inArray(files.claim_id, ids), isNull(files.removed_at))).orderBy(asc(files.row_seq));
  const map = new Map<string, DeceasedFile[]>();
  for (const row of rows) map.set(row.claim_id, [...(map.get(row.claim_id) ?? []), toFile(row)]);
  return map;
}

/** One clerk's records (`employeeId`) or everyone's, newest death first; removed ones only when asked. */
export async function listDeceased(options: { employeeId?: string; includeRemoved?: boolean } = {}): Promise<DeceasedRecord[]> {
  const where = and(options.employeeId ? eq(claims.employee_id, options.employeeId) : undefined, options.includeRemoved ? undefined : eq(claims.status, "Active"));
  const rows = await getDb().select().from(claims).where(where).orderBy(desc(claims.date_of_death), desc(claims.row_seq));
  const attached = await filesFor(rows.map((row) => row.claim_id));
  return rows.map((row) => toRecord(row, attached.get(row.claim_id) ?? []));
}

async function ownRecord(id: string, employeeId: string) {
  const [row] = await getDb().select().from(claims).where(eq(claims.claim_id, text(id)));
  if (!row) throw new Error("Record not found. Refresh the list.");
  if (row.employee_id !== employeeId) throw new Error("Only the clerk who encoded this record changes it.");
  return row;
}

async function withFiles(id: string) {
  const [row] = await getDb().select().from(claims).where(eq(claims.claim_id, id));
  return toRecord(row, (await filesFor([id])).get(id) ?? []);
}

/** Refuses a second active record of the same person with the same date of death. */
async function refuseDuplicate(fields: { deceased_name: string; date_of_death: string }, exceptId = "") {
  const [other] = await getDb().select({ id: claims.claim_id, by: claims.employee_name, branch: claims.branch }).from(claims)
    .where(and(eq(claims.status, "Active"), eq(claims.date_of_death, fields.date_of_death), sql`lower(${claims.deceased_name}) = ${fields.deceased_name.toLowerCase()}`));
  if (other && other.id !== exceptId) throw new Error(`${fields.deceased_name} with this date of death is already encoded (${other.branch}, by ${text(other.by) || "another clerk"}).`);
}

export async function addDeceased(clerk: { employeeId: string; name: string }, input: Record<string, unknown>) {
  const fields = await deceasedFields(input, await deceasedBranches(clerk.employeeId));
  await refuseDuplicate(fields);
  const actor = getEncoder();
  const id = createReadableId("DEC");
  await getDb().insert(claims).values({
    ...fields, claim_id: id, employee_id: clerk.employeeId, employee_name: clerk.name, status: "Active", updated_at: actor.encodedAt,
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  });
  return withFiles(id);
}

export async function updateDeceased(employeeId: string, id: string, input: Record<string, unknown>) {
  const row = await ownRecord(id, employeeId);
  if (row.status !== "Active") throw new Error("This record was removed. Restore it first.");
  const fields = await deceasedFields(input, await deceasedBranches(employeeId));
  await refuseDuplicate(fields, row.claim_id);
  await getDb().update(claims).set({ ...fields, updated_at: getEncoder().encodedAt }).where(eq(claims.claim_id, row.claim_id));
  return withFiles(row.claim_id);
}

/** Removes a record, with the reason (kept), or restores it. */
export async function setDeceasedRemoved(employeeId: string, id: string, removed: boolean, reason = "") {
  const row = await ownRecord(id, employeeId);
  const actor = getEncoder();
  if (removed) {
    if (row.status === "Removed") throw new Error("This record is already removed.");
    if (text(reason).length < 3) throw new Error("Say why the record is removed (encoded twice, wrong person...).");
    await getDb().update(claims).set({ status: "Removed", removed_reason: text(reason).slice(0, 200), removed_at: actor.encodedAt, updated_at: actor.encodedAt }).where(eq(claims.claim_id, row.claim_id));
  } else {
    if (row.status === "Active") throw new Error("This record is not removed.");
    await refuseDuplicate({ deceased_name: row.deceased_name, date_of_death: text(row.date_of_death) }, row.claim_id);
    await getDb().update(claims).set({ status: "Active", removed_reason: null, removed_at: null, updated_at: actor.encodedAt }).where(eq(claims.claim_id, row.claim_id));
  }
  return withFiles(row.claim_id);
}

/** Attaches one file to the clerk's own active record. */
export async function attachDeceasedFile(employeeId: string, claimId: string, file: { name: string; type: string; bytes: Uint8Array }) {
  const row = await ownRecord(claimId, employeeId);
  if (row.status !== "Active") throw new Error("This record was removed. Restore it first.");
  const extension = DECEASED_FILE_TYPES[text(file.type).toLowerCase()];
  if (!extension) throw new Error(`${file.name || "This file"} cannot be attached: use a photo, PDF, Word or Excel file.`);
  if (!file.bytes.length) throw new Error(`${file.name || "This file"} is empty.`);
  if (file.bytes.length > MAX_DECEASED_FILE_BYTES) throw new Error(`${file.name || "This file"} is over 4 MB. Attach a smaller copy (or a photo, which is shrunk for you).`);
  const [{ count }] = await getDb().select({ count: sql<number>`count(*)::int` }).from(files).where(and(eq(files.claim_id, row.claim_id), isNull(files.removed_at)));
  if (count >= MAX_DECEASED_FILES) throw new Error(`A record holds up to ${MAX_DECEASED_FILES} files. Remove one first.`);
  const actor = getEncoder();
  const id = createReadableId("DECF");
  const path = `deceased/${row.claim_id}/${id}.${extension}`;
  await storePhoto(path, file.bytes, file.type);
  const name = text(file.name).replace(/[\\/:*?"<>|]+/g, "_").slice(0, 160) || `file.${extension}`;
  await getDb().insert(files).values({
    file_id: id, claim_id: row.claim_id, file_name: name, mime_type: file.type, size_bytes: file.bytes.length, storage_path: path,
    encoded_by_user_id: actor.userId, encoded_by_employee_id: actor.employeeId, encoded_by_name: actor.name, encoded_at: actor.encodedAt,
  });
  return withFiles(row.claim_id);
}

/** Takes a file off the clerk's own record; the stored file and its row stay. */
export async function removeDeceasedFile(employeeId: string, fileId: string) {
  const [file] = await getDb().select().from(files).where(eq(files.file_id, text(fileId)));
  if (!file || file.removed_at) throw new Error("File not found. Refresh the list.");
  await ownRecord(file.claim_id, employeeId);
  await getDb().update(files).set({ removed_at: getEncoder().encodedAt }).where(eq(files.file_id, file.file_id));
  return withFiles(file.claim_id);
}

/** A file's bytes for the clerk who encoded the record, or for anyone who sees every record (`canOversee`). */
export async function readDeceasedFile(viewer: { employeeId: string; canOversee: boolean }, fileId: string) {
  const [file] = await getDb().select().from(files).where(eq(files.file_id, text(fileId)));
  if (!file || file.removed_at) throw new Error("File not found.");
  if (!viewer.canOversee) await ownRecord(file.claim_id, viewer.employeeId);
  return { name: file.file_name, type: file.mime_type, bytes: await readStoredFile(file.storage_path) };
}

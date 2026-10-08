/**
 * PostgreSQL schema (Supabase). One table per former Google Sheets tab, with the same snake_case column names, so each
 * module's rewrite maps column for column. See docs/supabase-migration-plan.md.
 *
 * Types: IDs, codes and phone numbers are text (leading zeroes kept); money is numeric(12,2) read as a JS number;
 * calendar dates are `date` read as "YYYY-MM-DD"; moments are timestamptz read as ISO strings; comma-separated lists
 * stay text as in the sheets; *_json columns are jsonb. Every table has row-level security on with no policies, so
 * Supabase's public API can never reach it; the app connects as the database owner from the server only.
 */
import { sql } from "drizzle-orm";
import { bigint, boolean, date, doublePrecision, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: "number" });
const day = (name: string) => date(name, { mode: "string" });
const moment = (name: string) => timestamp(name, { withTimezone: true, mode: "string" });
/** Who saved the row (lib/encoder-context.ts). */
const encoder = () => ({
  encoded_by_user_id: text(),
  encoded_by_employee_id: text(),
  encoded_by_name: text(),
  encoded_at: moment("encoded_at"),
});
/** Receipt and application numbers compare without spaces or punctuation, ignoring case (lib/duplicate-entries.ts entryKey). */
const entryKey = (column: string) => sql.raw(`upper(regexp_replace(coalesce(${column}, ''), '[^A-Za-z0-9]', '', 'g'))`);
const employeeRef = { onUpdate: "cascade" as const };
/**
 * Every table keeps its rows in the order they were added (row_seq), like rows in a sheet tab. lib/sheets-on-db.ts
 * uses it so code written for Google Sheets ("row 5 of Remittances") reads and writes the same rows here.
 */
const rowSeq = () => ({ row_seq: bigint("row_seq", { mode: "number" }).generatedAlwaysAsIdentity() });

// ---------------------------------------------------------------- organization

export const branches = pgTable("branches", {
  ...rowSeq(),
  branch_id: text().primaryKey(),
  branch_name_code: text().notNull(),
  territory: text(),
  barangay: text(),
  city_municipality: text(),
  province: text(),
  country: text(),
  postal_code: text(),
  contact_number: text(),
  email: text(),
  date_opened: day("date_opened"),
  date_closed: day("date_closed"),
  status: text(),
  ...encoder(),
}, (t) => [uniqueIndex("branches_name_code_key").on(t.branch_name_code)]).enableRLS();

export const employees = pgTable("employees", {
  ...rowSeq(),
  employee_id: text().primaryKey(),
  full_name: text().notNull(),
  primary_branch: text(),
  operational_roles: text(),
  employment_status: text(),
  contact_number: text(),
  email: text(),
  date_hired: day("date_hired"),
  created_at: moment("created_at"),
  ...encoder(),
}, (t) => [index("employees_full_name_idx").on(sql`lower(${t.full_name})`)]).enableRLS();

export const employee_branches = pgTable("employee_branches", {
  ...rowSeq(),
  assignment_id: text().primaryKey(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  branch_id: text().notNull().references(() => branches.branch_id, { onUpdate: "cascade" }),
  ...encoder(),
}, (t) => [
  index("employee_branches_employee_idx").on(t.employee_id),
  uniqueIndex("employee_branches_employee_branch_key").on(t.employee_id, t.branch_id),
]).enableRLS();

export const roles = pgTable("roles", {
  ...rowSeq(),
  role_id: text().primaryKey(),
  role_name: text().notNull(),
  description: text(),
  manage_users: boolean().notNull().default(false),
  manage_attendance: boolean().notNull().default(false),
  view_attendance_reports: boolean().notNull().default(false),
  status: text(),
  ...encoder(),
  page_access: text(),
}).enableRLS();

export const users = pgTable("users", {
  ...rowSeq(),
  user_id: text().primaryKey(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  full_name: text(),
  password_hash: text().notNull(),
  status: text(),
  created_at: moment("created_at"),
  role_id: text().references(() => roles.role_id),
  ...encoder(),
}, (t) => [uniqueIndex("users_employee_id_key").on(t.employee_id)]).enableRLS();

export const user_roles = pgTable("user_roles", {
  ...rowSeq(),
  user_id: text().notNull().references(() => users.user_id, { onDelete: "cascade" }),
  role_id: text().notNull().references(() => roles.role_id),
  ...encoder(),
}, (t) => [primaryKey({ columns: [t.user_id, t.role_id] })]).enableRLS();

export const system_settings = pgTable("system_settings", {
  ...rowSeq(),
  setting_key: text().primaryKey(),
  value: text(),
  updated_at: moment("updated_at"),
  updated_by: text(),
}).enableRLS();

export const holidays = pgTable("holidays", {
  ...rowSeq(),
  holiday_id: text().primaryKey(),
  holiday_date: day("holiday_date").notNull(),
  name: text().notNull(),
  holiday_type: text(),
  notes: text(),
  ...encoder(),
}, (t) => [index("holidays_date_idx").on(t.holiday_date)]).enableRLS();

export const remittance_methods = pgTable("remittance_methods", {
  ...rowSeq(),
  remittance_method_id: text().primaryKey(),
  method_name: text().notNull(),
  is_cash: boolean().notNull().default(false),
  requires_reference: boolean().notNull().default(false),
  status: text(),
  ...encoder(),
}).enableRLS();

// ---------------------------------------------------------------- programs

export const program_categories = pgTable("program_categories", {
  ...rowSeq(),
  category_id: text().primaryKey(),
  category_name: text().notNull(),
  status: text(),
  description: text(),
  ...encoder(),
}).enableRLS();

export const programs = pgTable("programs", {
  ...rowSeq(),
  program_id: text().primaryKey(),
  program_code: text(),
  program_name: text().notNull(),
  base_pay: money("base_pay"),
  status: text(),
  description: text(),
  ...encoder(),
  registration_fee_required: boolean().notNull().default(false),
  registration_amount: money("registration_amount"),
  pay_balance_total: money("pay_balance_total"),
  age_restricted: boolean().notNull().default(false),
  min_age: integer(),
  max_age: integer(),
  new_sale_incentive_type: text(),
  new_sale_incentive_amount: money("new_sale_incentive_amount"),
  category_id: text().references(() => program_categories.category_id),
  new_sale_amount_editable: boolean().notNull().default(false),
  collection_amount_editable: boolean().notNull().default(false),
  /** Flexible payments: base_pay is the minimum monthly payment and amounts follow what is paid (lib/account-rules.ts). */
  flexible: boolean().notNull().default(false),
  /** Null = no maximum for a flexible monthly payment. */
  max_monthly_payment: money("max_monthly_payment"),
}).enableRLS();

export const program_incentives = pgTable("program_incentives", {
  ...rowSeq(),
  incentive_id: text().primaryKey(),
  program_id: text().notNull().references(() => programs.program_id),
  role: text(),
  from_month: integer(),
  to_month: integer(),
  incentive_type: text(),
  mark_up: money("mark_up"),
  incentive_amount: money("incentive_amount"),
  ...encoder(),
  branch_id: text().references(() => branches.branch_id, { onUpdate: "cascade" }),
}, (t) => [index("program_incentives_program_idx").on(t.program_id)]).enableRLS();

// ---------------------------------------------------------------- members

export const members = pgTable("members", {
  ...rowSeq(),
  member_id: text().primaryKey(),
  member_number: text().notNull(),
  surname: text().notNull(),
  first_name: text().notNull(),
  middle_name: text(),
  name_extension: text(),
  birthdate: day("birthdate"),
  birthplace: text(),
  gender: text(),
  age: integer(),
  civil_status: text(),
  member_contact: text(),
  address: text(),
  claimant_name: text(),
  claimant_contact: text(),
  claimant_same_address: boolean().notNull().default(false),
  claimant_address: text(),
  status: text(),
  ...encoder(),
}, (t) => [
  uniqueIndex("members_member_number_key").on(t.member_number),
  index("members_name_idx").on(sql`lower(${t.surname})`, sql`lower(${t.first_name})`),
]).enableRLS();

export const member_programs = pgTable("member_programs", {
  ...rowSeq(),
  enrollment_id: text().primaryKey(),
  member_id: text().notNull().references(() => members.member_id),
  member_number: text(),
  program_id: text().notNull().references(() => programs.program_id),
  doi: day("doi"),
  branch: text(),
  mas: text(),
  remittance_method: text(),
  registration_fee: boolean().notNull().default(false),
  registration_amount: money("registration_amount"),
  amount_paid: money("amount_paid"),
  program_terms: text(),
  status: text(),
  date_created: moment("date_created"),
  ...encoder(),
  account_status: text(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [index("member_programs_branch_id_idx").on(t.branch_id), index("member_programs_mas_employee_id_idx").on(t.mas_employee_id), 
  // A member enrolls in each program once (app/api/sales/route.ts checks first; this stops two racing saves).
  uniqueIndex("member_programs_member_program_key").on(t.member_id, t.program_id),
  index("member_programs_member_idx").on(t.member_id),
  index("member_programs_program_idx").on(t.program_id),
  index("member_programs_mas_idx").on(t.mas),
  index("member_programs_branch_idx").on(t.branch),
]).enableRLS();

export const member_transfers = pgTable("member_transfers", {
  ...rowSeq(),
  transfer_id: text().primaryKey(),
  enrollment_id: text().references(() => member_programs.enrollment_id),
  member_id: text().references(() => members.member_id),
  member_number: text(),
  program_id: text(),
  branch: text(),
  from_mas: text(),
  to_mas: text(),
  to_employee_id: text().references(() => employees.employee_id, employeeRef),
  reason: text(),
  ...encoder(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  from_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [index("member_transfers_branch_id_idx").on(t.branch_id), index("member_transfers_from_employee_id_idx").on(t.from_employee_id), index("member_transfers_enrollment_idx").on(t.enrollment_id)]).enableRLS();

// ---------------------------------------------------------------- remittances (parent of sales and collections links)

export const remittances = pgTable("remittances", {
  ...rowSeq(),
  remittance_id: text().primaryKey(),
  branch: text(),
  mas: text(),
  date_remitted: day("date_remitted"),
  status: text(),
  created_at: moment("created_at"),
  ...encoder(),
  gross_collection: money("gross_collection"),
  total_remittance: money("total_remittance"),
  difference: money("difference"),
  accountable_employee_id: text().references(() => employees.employee_id, employeeRef),
  accountable_role: text(),
  collection_count: integer(),
  received_by_employee_id: text(),
  received_by_name: text(),
  decision_by_user_id: text(),
  decision_by_employee_id: text(),
  decision_by_name: text(),
  decision_at: moment("decision_at"),
  remarks: text(),
  rejection_reason: text(),
  fidelity_amount: money("fidelity_amount"),
  remittance_type: text(),
  time_remitted: text(),
  cash_count: text(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [index("remittances_branch_id_idx").on(t.branch_id), index("remittances_mas_employee_id_idx").on(t.mas_employee_id), 
  index("remittances_status_idx").on(t.status),
  index("remittances_encoder_idx").on(t.encoded_by_employee_id),
  index("remittances_date_idx").on(t.date_remitted),
]).enableRLS();

// ---------------------------------------------------------------- new sales

export const sales = pgTable("sales", {
  ...rowSeq(),
  sale_id: text().primaryKey(),
  date_created: moment("date_created"),
  branch: text(),
  mas: text(),
  date_remitted: day("date_remitted"),
  member_number: text(),
  surname: text(),
  first_name: text(),
  middle_name: text(),
  name_extension: text(),
  birthdate: day("birthdate"),
  birthplace: text(),
  gender: text(),
  age: integer(),
  civil_status: text(),
  member_contact: text(),
  address: text(),
  claimant_name: text(),
  claimant_contact: text(),
  claimant_same_address: boolean().notNull().default(false),
  claimant_address: text(),
  program_id: text().notNull().references(() => programs.program_id),
  doi: day("doi"),
  payment_method: text(),
  registration_fee: boolean().notNull().default(false),
  registration_amount: money("registration_amount"),
  amount_paid: money("amount_paid"),
  notes: text(),
  application_no: text(),
  or_number: text(),
  or_date: day("or_date"),
  ...encoder(),
  remittance_status: text(),
  linked_remittance_id: text().references(() => remittances.remittance_id),
  accountable_employee_id: text().references(() => employees.employee_id, employeeRef),
  penalty_amount: money("penalty_amount"),
  penalty_note: text(),
  mas_incentive: money("mas_incentive"),
  remittance_amount: money("remittance_amount"),
  fidelity_amount: money("fidelity_amount"),
  forfeited_incentive: money("forfeited_incentive"),
  backdate_reason: text(),
  /** Normalized application_no; one sale per application number. */
  application_key: text().generatedAlwaysAs(entryKey("application_no")),
  /** True only on the second or later copy of an application number that was already duplicated before the move. */
  legacy_duplicate: boolean().notNull().default(false),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [index("sales_branch_id_idx").on(t.branch_id), index("sales_mas_employee_id_idx").on(t.mas_employee_id), 
  uniqueIndex("sales_application_key_unique").on(t.application_key).where(sql`${t.application_key} <> '' and not ${t.legacy_duplicate}`),
  index("sales_encoder_idx").on(t.encoded_by_employee_id, t.encoded_at),
  index("sales_remittance_status_idx").on(t.remittance_status),
  index("sales_member_number_idx").on(t.member_number),
  index("sales_linked_remittance_idx").on(t.linked_remittance_id),
]).enableRLS();

/**
 * Clearing (October 8, 2026): after checking a MAS's physical receipts and bank slips, the entry clerk lists them here.
 * The clearing time is when the cash was received, so entries encoded later keep the incentive they earned
 * (lib/clearing.ts). Open until that MAS's entries for the day are sent for approval (Encoded) or it is removed.
 */
export const clearings = pgTable("clearings", {
  ...rowSeq(),
  clearing_id: text().primaryKey(),
  branch: text().notNull(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  employee_name: text(),
  cleared_at: moment("cleared_at").notNull(),
  cleared_date: day("cleared_date").notNull(),
  amount: money("amount"),
  notes: text(),
  status: text().notNull().default("Open"),
  remittance_id: text(),
  closed_at: moment("closed_at"),
  closed_reason: text(),
  ...encoder(),
}, (t) => [index("clearings_employee_date_idx").on(t.employee_id, t.cleared_date), index("clearings_status_idx").on(t.status)]).enableRLS();

/**
 * New Sales a MAS submits from the field (MAS New Sales page). An Entry Clerk assigned to the branch reviews one on New
 * Sales → Submitted by MAS and saves it as a normal New Sales batch (status Saved, sale_ids set in the same transaction),
 * or returns it with a reason. `sales` holds the sale cards exactly as the form keeps them.
 */
export const sale_submissions = pgTable("sale_submissions", {
  ...rowSeq(),
  submission_id: text().primaryKey(),
  branch_id: text().notNull(),
  branch: text().notNull(),
  mas_employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  mas: text().notNull(),
  status: text().notNull().default("Submitted"),
  sales: jsonb().notNull(),
  sale_count: integer().notNull(),
  total_amount: money("total_amount").notNull(),
  submitted_at: moment("submitted_at").notNull(),
  return_reason: text(),
  reviewed_by_employee_id: text(),
  reviewed_by_name: text(),
  reviewed_at: moment("reviewed_at"),
  sale_ids: text(),
  ...encoder(),
}, (t) => [
  index("sale_submissions_branch_status_idx").on(t.branch_id, t.status),
  index("sale_submissions_mas_idx").on(t.mas_employee_id),
]).enableRLS();

export const beneficiaries = pgTable("beneficiaries", {
  ...rowSeq(),
  beneficiary_id: text().primaryKey(),
  member_id: text().notNull().references(() => members.member_id),
  sale_id: text().references(() => sales.sale_id),
  surname: text(),
  first_name: text(),
  middle_name: text(),
  birthdate: day("birthdate"),
  age: integer(),
  relationship: text(),
  ...encoder(),
}, (t) => [index("beneficiaries_member_idx").on(t.member_id)]).enableRLS();

// ---------------------------------------------------------------- collections

export const collections = pgTable("collections", {
  ...rowSeq(),
  collection_id: text().primaryKey(),
  collection_batch_id: text().notNull(),
  enrollment_id: text().notNull().references(() => member_programs.enrollment_id),
  member_id: text().notNull().references(() => members.member_id),
  member_number: text(),
  program_id: text().notNull().references(() => programs.program_id),
  branch: text(),
  mas: text(),
  or_number: text(),
  or_date: day("or_date"),
  amount_collected: money("amount_collected").notNull(),
  month_from: text(),
  month_to: text(),
  nop_from: integer(),
  nop_to: integer(),
  reactivation: boolean().notNull().default(false),
  transferred: boolean().notNull().default(false),
  suspended: text(),
  original_mas: text(),
  status: text().notNull(),
  created_at: moment("created_at"),
  ...encoder(),
  collected_by_role: text(),
  remittance_amount: money("remittance_amount"),
  remittance_breakdown: jsonb(),
  remittance_status: text(),
  linked_remittance_id: text().references(() => remittances.remittance_id),
  accountable_employee_id: text().references(() => employees.employee_id, employeeRef),
  accountable_name: text(),
  accountable_role: text(),
  remittance_method: text(),
  payment_reference: text(),
  penalty_amount: money("penalty_amount"),
  penalty_note: text(),
  fidelity_amount: money("fidelity_amount"),
  forfeited_incentive: money("forfeited_incentive"),
  backdate_reason: text(),
  date_remitted: day("date_remitted"),
  /** Normalized or_number; a receipt is used by one posted collection only. */
  or_key: text().generatedAlwaysAs(entryKey("or_number")),
  /** True only on the second or later copy of an OR number that was already duplicated before the move. */
  legacy_duplicate: boolean().notNull().default(false),
  /**
   * Links to the branch and MAS records (phase 2 of linked tables, October 7, 2026). Filled by the database from the
   * branch and mas names on every insert or update (trigger fill_collection_links, migration 0011), so every writer is
   * covered; empty when a name matches no record. Hidden from the Sheets layer (lib/sheets-on-db.ts).
   */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [
  uniqueIndex("collections_or_key_unique").on(t.or_key).where(sql`${t.or_key} <> '' and ${t.status} = 'Posted' and not ${t.legacy_duplicate}`),
  index("collections_enrollment_idx").on(t.enrollment_id),
  index("collections_member_idx").on(t.member_id),
  index("collections_batch_idx").on(t.collection_batch_id),
  index("collections_encoder_idx").on(t.encoded_by_employee_id, t.encoded_at),
  index("collections_or_date_idx").on(t.or_date),
  index("collections_created_idx").on(t.created_at),
  index("collections_branch_id_idx").on(t.branch_id),
  index("collections_mas_employee_idx").on(t.mas_employee_id),
  index("collections_remittance_status_idx").on(t.remittance_status),
  index("collections_linked_remittance_idx").on(t.linked_remittance_id),
  index("collections_mas_idx").on(t.mas),
  index("collections_branch_idx").on(t.branch),
]).enableRLS();

export const remittance_collections = pgTable("remittance_collections", {
  ...rowSeq(),
  remittance_collection_id: text().primaryKey(),
  remittance_id: text().notNull().references(() => remittances.remittance_id),
  collection_id: text().notNull(),
  amount: money("amount"),
  linked_at: moment("linked_at"),
  ...encoder(),
}, (t) => [
  index("remittance_collections_remittance_idx").on(t.remittance_id),
  index("remittance_collections_collection_idx").on(t.collection_id),
]).enableRLS();

/** Receipt photos: which entries a photo covers, and the compressed photo itself in up to four base64 chunks. */
export const receipt_photos = pgTable("receipt_photos", {
  ...rowSeq(),
  photo_id: text().primaryKey(),
  entry_ids: text().notNull(),
  mime_type: text(),
  size_bytes: integer(),
  width: integer(),
  height: integer(),
  uploaded_at: moment("uploaded_at"),
  uploaded_by_employee_id: text(),
  uploaded_by_name: text(),
  /** For a later move of the photo files to Supabase Storage (bucket "receipts"); blank while the data is below. */
  storage_path: text(),
  chunk_count: integer(),
  photo_data_1: text(),
  photo_data_2: text(),
  photo_data_3: text(),
  photo_data_4: text(),
}).enableRLS();

// ---------------------------------------------------------------- finance

export const cash_accounts = pgTable("cash_accounts", {
  ...rowSeq(),
  cash_account_id: text().primaryKey(),
  account_name: text().notNull(),
  account_type: text(),
  opening_balance: money("opening_balance"),
  status: text(),
  ...encoder(),
}).enableRLS();

export const expenses = pgTable("expenses", {
  ...rowSeq(),
  expense_id: text().primaryKey(),
  expense_date: day("expense_date"),
  category: text(),
  description: text(),
  amount: money("amount"),
  payee: text(),
  paid_by: text(),
  branch: text(),
  payment_method: text(),
  reference_number: text(),
  receipt_number: text(),
  status: text(),
  remarks: text(),
  created_at: moment("created_at"),
  voided_at: moment("voided_at"),
  voided_by_user_id: text(),
  void_reason: text(),
  ...encoder(),
  attachments: text(),
  approved_by: text(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
}, (t) => [index("expenses_branch_id_idx").on(t.branch_id), index("expenses_date_idx").on(t.expense_date)]).enableRLS();

export const cash_transactions = pgTable("cash_transactions", {
  ...rowSeq(),
  transaction_id: text().primaryKey(),
  transaction_date: day("transaction_date"),
  direction: text(),
  category: text(),
  description: text(),
  amount: money("amount"),
  branch: text(),
  cash_account: text(),
  reference_type: text(),
  reference_id: text(),
  status: text(),
  remarks: text(),
  created_at: moment("created_at"),
  voided_at: moment("voided_at"),
  voided_by_user_id: text(),
  void_reason: text(),
  ...encoder(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
}, (t) => [index("cash_transactions_branch_id_idx").on(t.branch_id), index("cash_transactions_date_idx").on(t.transaction_date)]).enableRLS();

export const vendor_payables = pgTable("vendor_payables", {
  ...rowSeq(),
  payable_id: text().primaryKey(),
  invoice_date: day("invoice_date"),
  due_date: day("due_date"),
  vendor: text(),
  category: text(),
  description: text(),
  amount: money("amount"),
  amount_paid: money("amount_paid"),
  balance: money("balance"),
  branch: text(),
  status: text(),
  reference_number: text(),
  remarks: text(),
  paid_at: moment("paid_at"),
  payment_account: text(),
  ...encoder(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
}, (t) => [index("vendor_payables_branch_id_idx").on(t.branch_id)]).enableRLS();

export const bank_deposits = pgTable("bank_deposits", {
  ...rowSeq(),
  deposit_id: text().primaryKey(),
  deposit_date: day("deposit_date"),
  employee_id: text().references(() => employees.employee_id, employeeRef),
  employee_name: text(),
  branch: text(),
  bank_account_name: text(),
  amount: money("amount"),
  transfer_type: text(),
  mas: text(),
  remarks: text(),
  status: text(),
  void_reason: text(),
  created_at: moment("created_at"),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
}, (t) => [index("bank_deposits_branch_id_idx").on(t.branch_id), index("bank_deposits_mas_employee_id_idx").on(t.mas_employee_id), index("bank_deposits_employee_idx").on(t.employee_id, t.deposit_date)]).enableRLS();

export const fidelity = pgTable("fidelity", {
  ...rowSeq(),
  fidelity_id: text().primaryKey(),
  mas_employee_id: text().references(() => employees.employee_id, employeeRef),
  mas_name: text(),
  collection_id: text(),
  remittance_id: text(),
  transaction_type: text(),
  incentive_amount: money("incentive_amount"),
  fidelity_amount: money("fidelity_amount"),
  transaction_date: day("transaction_date"),
  status: text(),
  notes: text(),
  ...encoder(),
}, (t) => [index("fidelity_employee_idx").on(t.mas_employee_id)]).enableRLS();

export const commissions = pgTable("commissions", {
  ...rowSeq(),
  commission_id: text().primaryKey(),
  employee_id: text().references(() => employees.employee_id, employeeRef),
  employee_name: text(),
  period_from: day("period_from"),
  period_to: day("period_to"),
  gross_incentive: money("gross_incentive"),
  fidelity_deduction: money("fidelity_deduction"),
  net_commission: money("net_commission"),
  status: text(),
  paid_at: moment("paid_at"),
  reference_number: text(),
  remarks: text(),
  ...encoder(),
}).enableRLS();

// ---------------------------------------------------------------- attendance and payroll

export const attendance = pgTable("attendance", {
  ...rowSeq(),
  attendance_id: text().primaryKey(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  attendance_date: day("attendance_date").notNull(),
  branch: text(),
  scheduled_time_in: text(),
  scheduled_time_out: text(),
  time_in: text(),
  time_out: text(),
  worked_hours: doublePrecision(),
  overtime_hours: doublePrecision(),
  attendance_status: text(),
  late_minutes: integer(),
  undertime_minutes: integer(),
  leave_type: text(),
  leave_approval_status: text(),
  notes: text(),
  created_at: moment("created_at"),
  updated_at: moment("updated_at"),
  ...encoder(),
  updated_by_user_id: text(),
  updated_by_employee_id: text(),
  updated_by_name: text(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
}, (t) => [index("attendance_branch_id_idx").on(t.branch_id), index("attendance_employee_date_idx").on(t.employee_id, t.attendance_date)]).enableRLS();

export const leave_requests = pgTable("leave_requests", {
  ...rowSeq(),
  leave_request_id: text().primaryKey(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  leave_type: text(),
  start_date: day("start_date"),
  end_date: day("end_date"),
  reason: text(),
  approval_status: text(),
  reviewed_by: text(),
  reviewed_at: moment("reviewed_at"),
  created_at: moment("created_at"),
  updated_at: moment("updated_at"),
  ...encoder(),
}, (t) => [index("leave_requests_employee_idx").on(t.employee_id)]).enableRLS();

export const pay_profiles = pgTable("pay_profiles", {
  ...rowSeq(),
  employee_id: text().primaryKey().references(() => employees.employee_id, employeeRef),
  base_type: text(),
  base_rate: money("base_rate"),
  commission_eligible: boolean().notNull().default(false),
  hours_per_day: doublePrecision(),
  overtime_multiplier: doublePrecision(),
  status: text(),
  notes: text(),
  updated_at: moment("updated_at"),
  ...encoder(),
}).enableRLS();

export const payroll_runs = pgTable("payroll_runs", {
  ...rowSeq(),
  payroll_id: text().primaryKey(),
  period_from: day("period_from"),
  period_to: day("period_to"),
  pay_date: day("pay_date"),
  status: text(),
  settings_json: jsonb(),
  employee_count: integer(),
  gross_total: money("gross_total"),
  deductions_total: money("deductions_total"),
  net_total: money("net_total"),
  prepared_by_user_id: text(),
  prepared_by_name: text(),
  prepared_at: moment("prepared_at"),
  approved_by_user_id: text(),
  approved_by_name: text(),
  approved_at: moment("approved_at"),
  paid_at: moment("paid_at"),
  cash_account: text(),
  payment_reference: text(),
  cash_transaction_id: text(),
  branch: text(),
  void_reason: text(),
  remarks: text(),
  updated_at: moment("updated_at"),
  ...encoder(),
  /** Links filled by the database from the names (trigger fill_links, migration 0013); hidden from the Sheets layer. */
  branch_id: text().references(() => branches.branch_id, employeeRef),
}, (t) => [index("payroll_runs_branch_id_idx").on(t.branch_id)]).enableRLS();

export const payroll_lines = pgTable("payroll_lines", {
  ...rowSeq(),
  payroll_line_id: text().primaryKey(),
  payroll_id: text().notNull().references(() => payroll_runs.payroll_id),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  employee_name: text(),
  roles: text(),
  base_type: text(),
  base_rate: money("base_rate"),
  daily_rate: money("daily_rate"),
  hourly_rate: money("hourly_rate"),
  days_paid: doublePrecision(),
  leave_days: doublePrecision(),
  absent_days: doublePrecision(),
  base_pay: money("base_pay"),
  overtime_hours: doublePrecision(),
  overtime_pay: money("overtime_pay"),
  late_minutes: integer(),
  late_deduction: money("late_deduction"),
  undertime_minutes: integer(),
  undertime_deduction: money("undertime_deduction"),
  absence_deduction: money("absence_deduction"),
  commission: money("commission"),
  commission_ids: text(),
  earned_incentive_reference: text(),
  line_status: text(),
  ...encoder(),
}, (t) => [index("payroll_lines_payroll_idx").on(t.payroll_id)]).enableRLS();

export const payroll_adjustments = pgTable("payroll_adjustments", {
  ...rowSeq(),
  adjustment_id: text().primaryKey(),
  payroll_id: text().notNull().references(() => payroll_runs.payroll_id),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  kind: text(),
  category: text(),
  amount: money("amount"),
  reason: text(),
  status: text(),
  ...encoder(),
}, (t) => [index("payroll_adjustments_payroll_idx").on(t.payroll_id)]).enableRLS();

// ---------------------------------------------------------------- reports, audits, corrections

export const report_remarks = pgTable("report_remarks", {
  ...rowSeq(),
  remark_id: text().primaryKey(),
  date_from: day("date_from"),
  date_to: day("date_to"),
  report_type: text(),
  scope: text(),
  comment: text(),
  created_at: moment("created_at"),
  ...encoder(),
}).enableRLS();

export const report_notes = pgTable("report_notes", {
  ...rowSeq(),
  note_key: text().primaryKey(),
  employee_id: text().references(() => employees.employee_id, employeeRef),
  period_kind: text(),
  period_start: day("period_start"),
  pending_cash: money("pending_cash"),
  specific_remarks: text(),
  pending_transactions: text(),
  other_comments: text(),
  updated_at: moment("updated_at"),
  updated_by: text(),
}).enableRLS();

/** Daily, Weekly, Monthly and Yearly Audits share one layout. */
const periodAudit = (name: string) => pgTable(name, {
  ...rowSeq(),
  audit_id: text().primaryKey(),
  report_date: day("report_date"),
  employee_id: text().references(() => employees.employee_id, employeeRef),
  employee_name: text(),
  status: text(),
  figures_json: jsonb(),
  findings: text(),
  result: text(),
  approved_by_user_id: text(),
  approved_by_name: text(),
  approved_at: moment("approved_at"),
  reopen_reason: text(),
  updated_at: moment("updated_at"),
  ...encoder(),
}, (t) => [index(`${name}_employee_date_idx`).on(t.employee_id, t.report_date)]).enableRLS();
export const daily_audits = periodAudit("daily_audits");
export const weekly_audits = periodAudit("weekly_audits");
export const monthly_audits = periodAudit("monthly_audits");
export const yearly_audits = periodAudit("yearly_audits");

export const record_corrections = pgTable("record_corrections", {
  ...rowSeq(),
  correction_id: text().primaryKey(),
  module: text(),
  record_id: text(),
  reason: text(),
  before_json: jsonb(),
  after_json: jsonb(),
  corrected_at: moment("corrected_at"),
  ...encoder(),
}, (t) => [index("record_corrections_record_idx").on(t.record_id)]).enableRLS();

/**
 * Cells the sheet-to-database copy could not convert, such as a date typed with a 3-digit year. The field is left blank
 * in its table and the original text is kept here until someone corrects the record and marks it resolved.
 */
export const copy_exceptions = pgTable("copy_exceptions", {
  ...rowSeq(),
  exception_id: text().primaryKey(),
  table_name: text().notNull(),
  record_id: text().notNull(),
  column_name: text().notNull(),
  original_text: text(),
  reason: text().notNull(),
  copied_at: moment("copied_at").notNull().defaultNow(),
  resolved_at: moment("resolved_at"),
  resolved_by_employee_id: text(),
  resolved_by_name: text(),
}, (t) => [index("copy_exceptions_open_idx").on(t.table_name, t.record_id).where(sql`${t.resolved_at} is null`)]).enableRLS();

/**
 * Written by the audit trigger (db/migrations, audit_row_change) on every update and delete of the tables above, with
 * the user the app named for the transaction. Rows copied from the old Audit Log sheet keep their original fields.
 */
export const audit_log = pgTable("audit_log", {
  ...rowSeq(),
  audit_id: text().primaryKey().default(sql`gen_random_uuid()::text`),
  logged_at: moment("logged_at").notNull().defaultNow(),
  action: text().notNull(),
  table_name: text().notNull(),
  record_id: text(),
  row_number: integer(),
  changes_json: jsonb(),
  user_id: text(),
  employee_id: text(),
  user_name: text(),
}, (t) => [
  index("audit_log_record_idx").on(t.table_name, t.record_id),
  index("audit_log_logged_at_idx").on(t.logged_at),
]).enableRLS();


/**
 * Notices to Explain issued to employees. A notice is in force for 90 days from the date issued (expires_on); three or
 * more in force at once make the employee subject to suspension (lib/nte.ts). Withdrawn notices no longer count.
 */
export const notices_to_explain = pgTable("notices_to_explain", {
  ...rowSeq(),
  nte_id: text().primaryKey(),
  employee_id: text().notNull().references(() => employees.employee_id, employeeRef),
  issued_on: day("issued_on").notNull(),
  expires_on: day("expires_on").notNull(),
  reason: text().notNull(),
  details: text(),
  status: text().notNull().default("Active"),
  withdrawn_reason: text(),
  ...encoder(),
}, (t) => [index("notices_to_explain_employee_idx").on(t.employee_id, t.expires_on)]).enableRLS();

CREATE TABLE "attendance" (
	"attendance_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"attendance_date" date NOT NULL,
	"branch" text,
	"scheduled_time_in" text,
	"scheduled_time_out" text,
	"time_in" text,
	"time_out" text,
	"worked_hours" double precision,
	"overtime_hours" double precision,
	"attendance_status" text,
	"late_minutes" integer,
	"undertime_minutes" integer,
	"leave_type" text,
	"leave_approval_status" text,
	"notes" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"updated_by_user_id" text,
	"updated_by_employee_id" text,
	"updated_by_name" text
);
--> statement-breakpoint
ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"audit_id" text PRIMARY KEY DEFAULT gen_random_uuid()::text NOT NULL,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"action" text NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text,
	"row_number" integer,
	"changes_json" jsonb,
	"user_id" text,
	"employee_id" text,
	"user_name" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bank_deposits" (
	"deposit_id" text PRIMARY KEY NOT NULL,
	"deposit_date" date,
	"employee_id" text,
	"employee_name" text,
	"branch" text,
	"bank_account_name" text,
	"amount" numeric(12, 2),
	"transfer_type" text,
	"mas" text,
	"remarks" text,
	"status" text,
	"void_reason" text,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "bank_deposits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "beneficiaries" (
	"beneficiary_id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"sale_id" text,
	"surname" text,
	"first_name" text,
	"middle_name" text,
	"birthdate" date,
	"age" integer,
	"relationship" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "beneficiaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "branches" (
	"branch_id" text PRIMARY KEY NOT NULL,
	"branch_name_code" text NOT NULL,
	"territory" text,
	"barangay" text,
	"city_municipality" text,
	"province" text,
	"country" text,
	"postal_code" text,
	"contact_number" text,
	"email" text,
	"date_opened" date,
	"date_closed" date,
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_accounts" (
	"cash_account_id" text PRIMARY KEY NOT NULL,
	"account_name" text NOT NULL,
	"account_type" text,
	"opening_balance" numeric(12, 2),
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "cash_transactions" (
	"transaction_id" text PRIMARY KEY NOT NULL,
	"transaction_date" date,
	"direction" text,
	"category" text,
	"description" text,
	"amount" numeric(12, 2),
	"branch" text,
	"cash_account" text,
	"reference_type" text,
	"reference_id" text,
	"status" text,
	"remarks" text,
	"created_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_transactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collections" (
	"collection_id" text PRIMARY KEY NOT NULL,
	"collection_batch_id" text NOT NULL,
	"enrollment_id" text NOT NULL,
	"member_id" text NOT NULL,
	"member_number" text,
	"program_id" text NOT NULL,
	"branch" text,
	"mas" text,
	"or_number" text,
	"or_date" date,
	"amount_collected" numeric(12, 2) NOT NULL,
	"month_from" text,
	"month_to" text,
	"nop_from" integer,
	"nop_to" integer,
	"reactivation" boolean DEFAULT false NOT NULL,
	"transferred" boolean DEFAULT false NOT NULL,
	"suspended" text,
	"original_mas" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"collected_by_role" text,
	"remittance_amount" numeric(12, 2),
	"remittance_breakdown" jsonb,
	"remittance_status" text,
	"linked_remittance_id" text,
	"accountable_employee_id" text,
	"accountable_name" text,
	"accountable_role" text,
	"remittance_method" text,
	"payment_reference" text,
	"penalty_amount" numeric(12, 2),
	"penalty_note" text,
	"fidelity_amount" numeric(12, 2),
	"forfeited_incentive" numeric(12, 2),
	"backdate_reason" text,
	"date_remitted" date,
	"or_key" text GENERATED ALWAYS AS (upper(regexp_replace(coalesce(or_number, ''), '[^A-Za-z0-9]', '', 'g'))) STORED,
	"legacy_duplicate" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commissions" (
	"commission_id" text PRIMARY KEY NOT NULL,
	"employee_id" text,
	"employee_name" text,
	"period_from" date,
	"period_to" date,
	"gross_incentive" numeric(12, 2),
	"fidelity_deduction" numeric(12, 2),
	"net_commission" numeric(12, 2),
	"status" text,
	"paid_at" timestamp with time zone,
	"reference_number" text,
	"remarks" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "commissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "daily_audits" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"report_date" date,
	"employee_id" text,
	"employee_name" text,
	"status" text,
	"figures_json" jsonb,
	"findings" text,
	"result" text,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"reopen_reason" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "daily_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employee_branches" (
	"assignment_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"branch_id" text NOT NULL,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employee_branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "employees" (
	"employee_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"primary_branch" text,
	"operational_roles" text,
	"employment_status" text,
	"contact_number" text,
	"email" text,
	"date_hired" date,
	"created_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expenses" (
	"expense_id" text PRIMARY KEY NOT NULL,
	"expense_date" date,
	"category" text,
	"description" text,
	"amount" numeric(12, 2),
	"payee" text,
	"paid_by" text,
	"branch" text,
	"payment_method" text,
	"reference_number" text,
	"receipt_number" text,
	"status" text,
	"remarks" text,
	"created_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"voided_by_user_id" text,
	"void_reason" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"attachments" text,
	"approved_by" text
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "fidelity" (
	"fidelity_id" text PRIMARY KEY NOT NULL,
	"mas_employee_id" text,
	"mas_name" text,
	"collection_id" text,
	"remittance_id" text,
	"transaction_type" text,
	"incentive_amount" numeric(12, 2),
	"fidelity_amount" numeric(12, 2),
	"transaction_date" date,
	"status" text,
	"notes" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "fidelity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "holidays" (
	"holiday_id" text PRIMARY KEY NOT NULL,
	"holiday_date" date NOT NULL,
	"name" text NOT NULL,
	"holiday_type" text,
	"notes" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "holidays" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"leave_request_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"leave_type" text,
	"start_date" date,
	"end_date" date,
	"reason" text,
	"approval_status" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_programs" (
	"enrollment_id" text PRIMARY KEY NOT NULL,
	"member_id" text NOT NULL,
	"member_number" text,
	"program_id" text NOT NULL,
	"doi" date,
	"branch" text,
	"mas" text,
	"remittance_method" text,
	"registration_fee" boolean DEFAULT false NOT NULL,
	"registration_amount" numeric(12, 2),
	"amount_paid" numeric(12, 2),
	"program_terms" text,
	"status" text,
	"date_created" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"account_status" text
);
--> statement-breakpoint
ALTER TABLE "member_programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "member_transfers" (
	"transfer_id" text PRIMARY KEY NOT NULL,
	"enrollment_id" text,
	"member_id" text,
	"member_number" text,
	"program_id" text,
	"branch" text,
	"from_mas" text,
	"to_mas" text,
	"to_employee_id" text,
	"reason" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "member_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "members" (
	"member_id" text PRIMARY KEY NOT NULL,
	"member_number" text NOT NULL,
	"surname" text NOT NULL,
	"first_name" text NOT NULL,
	"middle_name" text,
	"name_extension" text,
	"birthdate" date,
	"birthplace" text,
	"gender" text,
	"age" integer,
	"civil_status" text,
	"member_contact" text,
	"address" text,
	"claimant_name" text,
	"claimant_contact" text,
	"claimant_same_address" boolean DEFAULT false NOT NULL,
	"claimant_address" text,
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "monthly_audits" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"report_date" date,
	"employee_id" text,
	"employee_name" text,
	"status" text,
	"figures_json" jsonb,
	"findings" text,
	"result" text,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"reopen_reason" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "monthly_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_profiles" (
	"employee_id" text PRIMARY KEY NOT NULL,
	"base_type" text,
	"base_rate" numeric(12, 2),
	"commission_eligible" boolean DEFAULT false NOT NULL,
	"hours_per_day" double precision,
	"overtime_multiplier" double precision,
	"status" text,
	"notes" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "pay_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_adjustments" (
	"adjustment_id" text PRIMARY KEY NOT NULL,
	"payroll_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"kind" text,
	"category" text,
	"amount" numeric(12, 2),
	"reason" text,
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_lines" (
	"payroll_line_id" text PRIMARY KEY NOT NULL,
	"payroll_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"roles" text,
	"base_type" text,
	"base_rate" numeric(12, 2),
	"daily_rate" numeric(12, 2),
	"hourly_rate" numeric(12, 2),
	"days_paid" double precision,
	"leave_days" double precision,
	"absent_days" double precision,
	"base_pay" numeric(12, 2),
	"overtime_hours" double precision,
	"overtime_pay" numeric(12, 2),
	"late_minutes" integer,
	"late_deduction" numeric(12, 2),
	"undertime_minutes" integer,
	"undertime_deduction" numeric(12, 2),
	"absence_deduction" numeric(12, 2),
	"commission" numeric(12, 2),
	"commission_ids" text,
	"earned_incentive_reference" text,
	"line_status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payroll_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"payroll_id" text PRIMARY KEY NOT NULL,
	"period_from" date,
	"period_to" date,
	"pay_date" date,
	"status" text,
	"settings_json" jsonb,
	"employee_count" integer,
	"gross_total" numeric(12, 2),
	"deductions_total" numeric(12, 2),
	"net_total" numeric(12, 2),
	"prepared_by_user_id" text,
	"prepared_by_name" text,
	"prepared_at" timestamp with time zone,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"cash_account" text,
	"payment_reference" text,
	"cash_transaction_id" text,
	"branch" text,
	"void_reason" text,
	"remarks" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "payroll_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_categories" (
	"category_id" text PRIMARY KEY NOT NULL,
	"category_name" text NOT NULL,
	"status" text,
	"description" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "program_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "program_incentives" (
	"incentive_id" text PRIMARY KEY NOT NULL,
	"program_id" text NOT NULL,
	"role" text,
	"from_month" integer,
	"to_month" integer,
	"incentive_type" text,
	"mark_up" numeric(12, 2),
	"incentive_amount" numeric(12, 2),
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"branch_id" text
);
--> statement-breakpoint
ALTER TABLE "program_incentives" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "programs" (
	"program_id" text PRIMARY KEY NOT NULL,
	"program_code" text,
	"program_name" text NOT NULL,
	"base_pay" numeric(12, 2),
	"status" text,
	"description" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"registration_fee_required" boolean DEFAULT false NOT NULL,
	"registration_amount" numeric(12, 2),
	"pay_balance_total" numeric(12, 2),
	"age_restricted" boolean DEFAULT false NOT NULL,
	"min_age" integer,
	"max_age" integer,
	"new_sale_incentive_type" text,
	"new_sale_incentive_amount" numeric(12, 2),
	"category_id" text,
	"new_sale_amount_editable" boolean DEFAULT false NOT NULL,
	"collection_amount_editable" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "receipt_photos" (
	"photo_id" text PRIMARY KEY NOT NULL,
	"entry_ids" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"uploaded_at" timestamp with time zone,
	"uploaded_by_employee_id" text,
	"uploaded_by_name" text,
	"storage_path" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_photos" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "record_corrections" (
	"correction_id" text PRIMARY KEY NOT NULL,
	"module" text,
	"record_id" text,
	"reason" text,
	"before_json" jsonb,
	"after_json" jsonb,
	"corrected_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "record_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "remittance_collections" (
	"remittance_collection_id" text PRIMARY KEY NOT NULL,
	"remittance_id" text NOT NULL,
	"collection_id" text NOT NULL,
	"amount" numeric(12, 2),
	"linked_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "remittance_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "remittance_methods" (
	"remittance_method_id" text PRIMARY KEY NOT NULL,
	"method_name" text NOT NULL,
	"is_cash" boolean DEFAULT false NOT NULL,
	"requires_reference" boolean DEFAULT false NOT NULL,
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "remittance_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "remittances" (
	"remittance_id" text PRIMARY KEY NOT NULL,
	"branch" text,
	"mas" text,
	"date_remitted" date,
	"status" text,
	"created_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"gross_collection" numeric(12, 2),
	"total_remittance" numeric(12, 2),
	"difference" numeric(12, 2),
	"accountable_employee_id" text,
	"accountable_role" text,
	"collection_count" integer,
	"received_by_employee_id" text,
	"received_by_name" text,
	"decision_by_user_id" text,
	"decision_by_employee_id" text,
	"decision_by_name" text,
	"decision_at" timestamp with time zone,
	"remarks" text,
	"rejection_reason" text,
	"fidelity_amount" numeric(12, 2),
	"remittance_type" text,
	"time_remitted" text,
	"cash_count" text
);
--> statement-breakpoint
ALTER TABLE "remittances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_notes" (
	"note_key" text PRIMARY KEY NOT NULL,
	"employee_id" text,
	"period_kind" text,
	"period_start" date,
	"pending_cash" numeric(12, 2),
	"specific_remarks" text,
	"pending_transactions" text,
	"other_comments" text,
	"updated_at" timestamp with time zone,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "report_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "report_remarks" (
	"remark_id" text PRIMARY KEY NOT NULL,
	"date_from" date,
	"date_to" date,
	"report_type" text,
	"scope" text,
	"comment" text,
	"created_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "report_remarks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"role_id" text PRIMARY KEY NOT NULL,
	"role_name" text NOT NULL,
	"description" text,
	"manage_users" boolean DEFAULT false NOT NULL,
	"manage_attendance" boolean DEFAULT false NOT NULL,
	"view_attendance_reports" boolean DEFAULT false NOT NULL,
	"status" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"page_access" text
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"sale_id" text PRIMARY KEY NOT NULL,
	"date_created" timestamp with time zone,
	"branch" text,
	"mas" text,
	"date_remitted" date,
	"member_number" text,
	"surname" text,
	"first_name" text,
	"middle_name" text,
	"name_extension" text,
	"birthdate" date,
	"birthplace" text,
	"gender" text,
	"age" integer,
	"civil_status" text,
	"member_contact" text,
	"address" text,
	"claimant_name" text,
	"claimant_contact" text,
	"claimant_same_address" boolean DEFAULT false NOT NULL,
	"claimant_address" text,
	"program_id" text NOT NULL,
	"doi" date,
	"payment_method" text,
	"registration_fee" boolean DEFAULT false NOT NULL,
	"registration_amount" numeric(12, 2),
	"amount_paid" numeric(12, 2),
	"notes" text,
	"application_no" text,
	"or_number" text,
	"or_date" date,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	"remittance_status" text,
	"linked_remittance_id" text,
	"accountable_employee_id" text,
	"penalty_amount" numeric(12, 2),
	"penalty_note" text,
	"mas_incentive" numeric(12, 2),
	"remittance_amount" numeric(12, 2),
	"fidelity_amount" numeric(12, 2),
	"forfeited_incentive" numeric(12, 2),
	"backdate_reason" text,
	"application_key" text GENERATED ALWAYS AS (upper(regexp_replace(coalesce(application_no, ''), '[^A-Za-z0-9]', '', 'g'))) STORED,
	"legacy_duplicate" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_settings" (
	"setting_key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp with time zone,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "system_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
ALTER TABLE "user_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"user_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"full_name" text,
	"password_hash" text NOT NULL,
	"status" text,
	"created_at" timestamp with time zone,
	"role_id" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendor_payables" (
	"payable_id" text PRIMARY KEY NOT NULL,
	"invoice_date" date,
	"due_date" date,
	"vendor" text,
	"category" text,
	"description" text,
	"amount" numeric(12, 2),
	"amount_paid" numeric(12, 2),
	"balance" numeric(12, 2),
	"branch" text,
	"status" text,
	"reference_number" text,
	"remarks" text,
	"paid_at" timestamp with time zone,
	"payment_account" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "vendor_payables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "weekly_audits" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"report_date" date,
	"employee_id" text,
	"employee_name" text,
	"status" text,
	"figures_json" jsonb,
	"findings" text,
	"result" text,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"reopen_reason" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "weekly_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "yearly_audits" (
	"audit_id" text PRIMARY KEY NOT NULL,
	"report_date" date,
	"employee_id" text,
	"employee_name" text,
	"status" text,
	"figures_json" jsonb,
	"findings" text,
	"result" text,
	"approved_by_user_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"reopen_reason" text,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "yearly_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beneficiaries" ADD CONSTRAINT "beneficiaries_sale_id_sales_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("sale_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_enrollment_id_member_programs_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."member_programs"("enrollment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_program_id_programs_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_linked_remittance_id_remittances_remittance_id_fk" FOREIGN KEY ("linked_remittance_id") REFERENCES "public"."remittances"("remittance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_accountable_employee_id_employees_employee_id_fk" FOREIGN KEY ("accountable_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD CONSTRAINT "daily_audits_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "employee_branches" ADD CONSTRAINT "employee_branches_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "fidelity" ADD CONSTRAINT "fidelity_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_programs" ADD CONSTRAINT "member_programs_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_programs" ADD CONSTRAINT "member_programs_program_id_programs_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD CONSTRAINT "member_transfers_enrollment_id_member_programs_enrollment_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."member_programs"("enrollment_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD CONSTRAINT "member_transfers_member_id_members_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD CONSTRAINT "member_transfers_to_employee_id_employees_employee_id_fk" FOREIGN KEY ("to_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD CONSTRAINT "monthly_audits_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "pay_profiles" ADD CONSTRAINT "pay_profiles_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payroll_id_payroll_runs_payroll_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."payroll_runs"("payroll_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_payroll_id_payroll_runs_payroll_id_fk" FOREIGN KEY ("payroll_id") REFERENCES "public"."payroll_runs"("payroll_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_lines" ADD CONSTRAINT "payroll_lines_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "program_incentives" ADD CONSTRAINT "program_incentives_program_id_programs_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "program_incentives" ADD CONSTRAINT "program_incentives_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_category_id_program_categories_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."program_categories"("category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittance_collections" ADD CONSTRAINT "remittance_collections_remittance_id_remittances_remittance_id_fk" FOREIGN KEY ("remittance_id") REFERENCES "public"."remittances"("remittance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_accountable_employee_id_employees_employee_id_fk" FOREIGN KEY ("accountable_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "report_notes" ADD CONSTRAINT "report_notes_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_program_id_programs_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_linked_remittance_id_remittances_remittance_id_fk" FOREIGN KEY ("linked_remittance_id") REFERENCES "public"."remittances"("remittance_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_accountable_employee_id_employees_employee_id_fk" FOREIGN KEY ("accountable_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("role_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD CONSTRAINT "weekly_audits_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD CONSTRAINT "yearly_audits_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "attendance_employee_date_idx" ON "attendance" USING btree ("employee_id","attendance_date");--> statement-breakpoint
CREATE INDEX "audit_log_record_idx" ON "audit_log" USING btree ("table_name","record_id");--> statement-breakpoint
CREATE INDEX "audit_log_logged_at_idx" ON "audit_log" USING btree ("logged_at");--> statement-breakpoint
CREATE INDEX "bank_deposits_employee_idx" ON "bank_deposits" USING btree ("employee_id","deposit_date");--> statement-breakpoint
CREATE INDEX "beneficiaries_member_idx" ON "beneficiaries" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branches_name_code_key" ON "branches" USING btree ("branch_name_code");--> statement-breakpoint
CREATE INDEX "cash_transactions_date_idx" ON "cash_transactions" USING btree ("transaction_date");--> statement-breakpoint
CREATE UNIQUE INDEX "collections_or_key_unique" ON "collections" USING btree ("or_key") WHERE "collections"."or_key" <> '' and "collections"."status" = 'Posted' and not "collections"."legacy_duplicate";--> statement-breakpoint
CREATE INDEX "collections_enrollment_idx" ON "collections" USING btree ("enrollment_id");--> statement-breakpoint
CREATE INDEX "collections_member_idx" ON "collections" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "collections_batch_idx" ON "collections" USING btree ("collection_batch_id");--> statement-breakpoint
CREATE INDEX "collections_encoder_idx" ON "collections" USING btree ("encoded_by_employee_id","encoded_at");--> statement-breakpoint
CREATE INDEX "collections_or_date_idx" ON "collections" USING btree ("or_date");--> statement-breakpoint
CREATE INDEX "collections_created_idx" ON "collections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "collections_remittance_status_idx" ON "collections" USING btree ("remittance_status");--> statement-breakpoint
CREATE INDEX "collections_linked_remittance_idx" ON "collections" USING btree ("linked_remittance_id");--> statement-breakpoint
CREATE INDEX "collections_mas_idx" ON "collections" USING btree ("mas");--> statement-breakpoint
CREATE INDEX "collections_branch_idx" ON "collections" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "daily_audits_employee_date_idx" ON "daily_audits" USING btree ("employee_id","report_date");--> statement-breakpoint
CREATE INDEX "employee_branches_employee_idx" ON "employee_branches" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "employees_full_name_idx" ON "employees" USING btree (lower("full_name"));--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "fidelity_employee_idx" ON "fidelity" USING btree ("mas_employee_id");--> statement-breakpoint
CREATE INDEX "holidays_date_idx" ON "holidays" USING btree ("holiday_date");--> statement-breakpoint
CREATE INDEX "leave_requests_employee_idx" ON "leave_requests" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "member_programs_member_idx" ON "member_programs" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "member_programs_program_idx" ON "member_programs" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "member_programs_mas_idx" ON "member_programs" USING btree ("mas");--> statement-breakpoint
CREATE INDEX "member_programs_branch_idx" ON "member_programs" USING btree ("branch");--> statement-breakpoint
CREATE INDEX "member_transfers_enrollment_idx" ON "member_transfers" USING btree ("enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_member_number_key" ON "members" USING btree ("member_number");--> statement-breakpoint
CREATE INDEX "members_name_idx" ON "members" USING btree (lower("surname"),lower("first_name"));--> statement-breakpoint
CREATE INDEX "monthly_audits_employee_date_idx" ON "monthly_audits" USING btree ("employee_id","report_date");--> statement-breakpoint
CREATE INDEX "payroll_adjustments_payroll_idx" ON "payroll_adjustments" USING btree ("payroll_id");--> statement-breakpoint
CREATE INDEX "payroll_lines_payroll_idx" ON "payroll_lines" USING btree ("payroll_id");--> statement-breakpoint
CREATE INDEX "program_incentives_program_idx" ON "program_incentives" USING btree ("program_id");--> statement-breakpoint
CREATE INDEX "record_corrections_record_idx" ON "record_corrections" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "remittance_collections_remittance_idx" ON "remittance_collections" USING btree ("remittance_id");--> statement-breakpoint
CREATE INDEX "remittance_collections_collection_idx" ON "remittance_collections" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "remittances_status_idx" ON "remittances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "remittances_encoder_idx" ON "remittances" USING btree ("encoded_by_employee_id");--> statement-breakpoint
CREATE INDEX "remittances_date_idx" ON "remittances" USING btree ("date_remitted");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_application_key_unique" ON "sales" USING btree ("application_key") WHERE "sales"."application_key" <> '' and not "sales"."legacy_duplicate";--> statement-breakpoint
CREATE INDEX "sales_encoder_idx" ON "sales" USING btree ("encoded_by_employee_id","encoded_at");--> statement-breakpoint
CREATE INDEX "sales_remittance_status_idx" ON "sales" USING btree ("remittance_status");--> statement-breakpoint
CREATE INDEX "sales_member_number_idx" ON "sales" USING btree ("member_number");--> statement-breakpoint
CREATE INDEX "sales_linked_remittance_idx" ON "sales" USING btree ("linked_remittance_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_employee_id_key" ON "users" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "weekly_audits_employee_date_idx" ON "weekly_audits" USING btree ("employee_id","report_date");--> statement-breakpoint
CREATE INDEX "yearly_audits_employee_date_idx" ON "yearly_audits" USING btree ("employee_id","report_date");
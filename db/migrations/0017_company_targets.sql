CREATE TABLE "company_targets" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "company_targets_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"target_id" text PRIMARY KEY NOT NULL,
	"period_type" text,
	"gross_sales_target" numeric(12, 2),
	"new_accounts_target" integer,
	"notes" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "company_targets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Audited and broadcast like every other table (migrations 0001, 0010).
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();

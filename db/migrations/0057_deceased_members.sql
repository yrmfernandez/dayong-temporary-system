CREATE TABLE "deceased_claim_files" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "deceased_claim_files_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"file_id" text PRIMARY KEY NOT NULL,
	"claim_id" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_path" text NOT NULL,
	"removed_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deceased_claim_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "deceased_claims" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "deceased_claims_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"claim_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"branch" text NOT NULL,
	"mas_employee_id" text,
	"mas_name" text,
	"member_id" text,
	"deceased_name" text NOT NULL,
	"program_id" text,
	"program_name" text,
	"converted_to_services" boolean DEFAULT false NOT NULL,
	"nop" integer,
	"total_monthly_deposit" numeric(12, 2),
	"date_of_death" date NOT NULL,
	"requirements_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requirements_other" text,
	"claims_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"claims_other" text,
	"service" text,
	"service_other" text,
	"full_payment_amount" numeric(12, 2),
	"date_of_release" date,
	"remarks" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"removed_reason" text,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "deceased_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "deceased_claim_files_claim_idx" ON "deceased_claim_files" USING btree ("claim_id");--> statement-breakpoint
CREATE INDEX "deceased_claims_clerk_idx" ON "deceased_claims" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "deceased_claims_branch_idx" ON "deceased_claims" USING btree ("branch","date_of_death");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
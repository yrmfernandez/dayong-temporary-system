CREATE TABLE "sale_submissions" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "sale_submissions_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"submission_id" text PRIMARY KEY NOT NULL,
	"branch_id" text NOT NULL,
	"branch" text NOT NULL,
	"mas_employee_id" text NOT NULL,
	"mas" text NOT NULL,
	"status" text DEFAULT 'Submitted' NOT NULL,
	"sales" jsonb NOT NULL,
	"sale_count" integer NOT NULL,
	"total_amount" numeric(12, 2) NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"return_reason" text,
	"reviewed_by_employee_id" text,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"sale_ids" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sale_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_submissions" ADD CONSTRAINT "sale_submissions_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "sale_submissions_branch_status_idx" ON "sale_submissions" USING btree ("branch_id","status");--> statement-breakpoint
CREATE INDEX "sale_submissions_mas_idx" ON "sale_submissions" USING btree ("mas_employee_id");--> statement-breakpoint
SELECT attach_audit_triggers();
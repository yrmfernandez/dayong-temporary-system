CREATE TABLE "turnover_variances" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "turnover_variances_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"variance_id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"entry_ids" jsonb NOT NULL,
	"branch" text,
	"mas" text,
	"accountable_employee_id" text,
	"date_remitted" date,
	"control_total" numeric(12, 2) NOT NULL,
	"system_total" numeric(12, 2) NOT NULL,
	"difference" numeric(12, 2) NOT NULL,
	"note" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"remittance_id" text,
	"resolution" text,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "turnover_variances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "turnover_variances_status_idx" ON "turnover_variances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "turnover_variances_remittance_idx" ON "turnover_variances" USING btree ("remittance_id");--> statement-breakpoint
CREATE INDEX "turnover_variances_entries_idx" ON "turnover_variances" USING gin ("entry_ids");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
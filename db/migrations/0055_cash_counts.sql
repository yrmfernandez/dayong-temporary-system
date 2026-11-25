CREATE TABLE "cash_counts" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "cash_counts_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"count_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"branch" text NOT NULL,
	"count_date" date NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"denominations" text,
	"note" text,
	"status" text DEFAULT 'Pending' NOT NULL,
	"decided_by_employee_id" text,
	"decided_by_name" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "cash_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD COLUMN "non_cash" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "cash_counts_clerk_idx" ON "cash_counts" USING btree ("employee_id","count_date");--> statement-breakpoint
CREATE INDEX "cash_counts_status_idx" ON "cash_counts" USING btree ("status");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
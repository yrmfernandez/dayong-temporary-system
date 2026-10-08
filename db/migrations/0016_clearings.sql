-- Clearing (October 8, 2026): MAS and employees whose receipts and bank slips the entry clerk has checked. New Sales
-- and Collections are saved only for an accountable person listed here for the day, and the clearing time is when
-- the cash was received (lib/clearing.ts).
CREATE TABLE "clearings" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "clearings_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"clearing_id" text PRIMARY KEY NOT NULL,
	"branch" text NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"cleared_at" timestamp with time zone NOT NULL,
	"cleared_date" date NOT NULL,
	"amount" numeric(12, 2),
	"notes" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"remittance_id" text,
	"closed_at" timestamp with time zone,
	"closed_reason" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clearings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clearings" ADD CONSTRAINT "clearings_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "clearings_employee_date_idx" ON "clearings" USING btree ("employee_id","cleared_date");--> statement-breakpoint
CREATE INDEX "clearings_status_idx" ON "clearings" USING btree ("status");--> statement-breakpoint
-- Audited and broadcast like every other table (migrations 0001, 0010).
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();

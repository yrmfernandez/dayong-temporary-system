-- Clock-in location check (October 24, 2026): where each branch office is, and where each clock-in was made.
CREATE TABLE "clock_in_checks" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "clock_in_checks_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"attendance_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"attendance_date" date NOT NULL,
	"branch_id" text,
	"branch" text,
	"result" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"accuracy_m" double precision,
	"distance_m" double precision,
	"radius_m" integer,
	"device_note" text,
	"checked_at" timestamp with time zone NOT NULL,
	"review_status" text,
	"review_note" text,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "clock_in_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "latitude" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "longitude" double precision;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "location_radius_m" integer;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "location_set_by" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "location_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clock_in_checks" ADD CONSTRAINT "clock_in_checks_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "clock_in_checks" ADD CONSTRAINT "clock_in_checks_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "clock_in_checks_date_idx" ON "clock_in_checks" USING btree ("attendance_date");--> statement-breakpoint
-- Audited and broadcast like every other table (migrations 0001, 0010).
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();

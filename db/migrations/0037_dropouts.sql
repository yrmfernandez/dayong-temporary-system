CREATE TABLE "dropout_requests" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "dropout_requests_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" text PRIMARY KEY NOT NULL,
	"branch_id" text,
	"branch" text NOT NULL,
	"member_id" text NOT NULL,
	"member_number" text NOT NULL,
	"member_name" text NOT NULL,
	"accounts" jsonb NOT NULL,
	"reason_type" text NOT NULL,
	"reason" text NOT NULL,
	"died_on" date,
	"status" text DEFAULT 'Pending' NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"requested_by_employee_id" text,
	"requested_by_name" text,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "dropout_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "deactivated_on" date;--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "died_on" date;--> statement-breakpoint
CREATE INDEX "dropout_requests_status_idx" ON "dropout_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "dropout_requests_member_idx" ON "dropout_requests" USING btree ("member_id");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
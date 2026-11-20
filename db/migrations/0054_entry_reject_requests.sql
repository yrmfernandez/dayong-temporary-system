CREATE TABLE "entry_reject_requests" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "entry_reject_requests_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" text PRIMARY KEY NOT NULL,
	"entry_kind" text NOT NULL,
	"entry_id" text NOT NULL,
	"remittance_id" text NOT NULL,
	"branch" text,
	"member_number" text,
	"member_name" text,
	"reference" text,
	"amount" numeric(12, 2),
	"reason" text NOT NULL,
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
ALTER TABLE "entry_reject_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "entry_reject_requests_status_idx" ON "entry_reject_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "entry_reject_requests_entry_idx" ON "entry_reject_requests" USING btree ("entry_id");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
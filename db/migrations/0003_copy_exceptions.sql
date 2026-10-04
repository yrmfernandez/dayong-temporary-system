CREATE TABLE "copy_exceptions" (
	"exception_id" text PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"record_id" text NOT NULL,
	"column_name" text NOT NULL,
	"original_text" text,
	"reason" text NOT NULL,
	"copied_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_employee_id" text,
	"resolved_by_name" text
);
--> statement-breakpoint
ALTER TABLE "copy_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "copy_exceptions_open_idx" ON "copy_exceptions" USING btree ("table_name","record_id") WHERE "copy_exceptions"."resolved_at" is null;--> statement-breakpoint
SELECT attach_audit_triggers();

CREATE TABLE "collection_drafts" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "collection_drafts_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"employee_id" text PRIMARY KEY NOT NULL,
	"collected_by" text DEFAULT 'MAS' NOT NULL,
	"member_mas_employee_id" text,
	"orc" boolean DEFAULT false NOT NULL,
	"entries" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "collection_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collection_submissions" ADD COLUMN "auto_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_drafts" ADD CONSTRAINT "collection_drafts_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
SELECT attach_change_triggers();

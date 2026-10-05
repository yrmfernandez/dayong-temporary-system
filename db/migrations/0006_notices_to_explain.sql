CREATE TABLE "notices_to_explain" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "notices_to_explain_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"nte_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"issued_on" date NOT NULL,
	"expires_on" date NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'Active' NOT NULL,
	"withdrawn_reason" text,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "notices_to_explain" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notices_to_explain" ADD CONSTRAINT "notices_to_explain_employee_id_employees_employee_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "notices_to_explain_employee_idx" ON "notices_to_explain" USING btree ("employee_id","expires_on");--> statement-breakpoint
SELECT attach_audit_triggers();

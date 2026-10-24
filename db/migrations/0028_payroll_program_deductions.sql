-- Payroll company program deductions (October 24, 2026): the program deducted for and the Collection that settled it.
ALTER TABLE "payroll_adjustments" ADD COLUMN "program_id" text;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "collection_id" text;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "collection_linked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD COLUMN "collection_linked_by" text;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_program_id_programs_program_id_fk" FOREIGN KEY ("program_id") REFERENCES "public"."programs"("program_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_collection_id_collections_collection_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("collection_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_adjustments_collection_key" ON "payroll_adjustments" USING btree ("collection_id") WHERE "payroll_adjustments"."collection_id" is not null;
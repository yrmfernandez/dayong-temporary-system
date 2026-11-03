ALTER TABLE "collection_submissions" ADD COLUMN "collected_by" text DEFAULT 'MAS' NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_submissions" ADD COLUMN "member_mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "collection_submissions" ADD COLUMN "member_mas" text;--> statement-breakpoint
ALTER TABLE "collection_submissions" ADD COLUMN "orc" boolean DEFAULT false NOT NULL;
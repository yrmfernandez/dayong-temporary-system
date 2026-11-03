ALTER TABLE "sale_submissions" ADD COLUMN "clearing_id" text;--> statement-breakpoint
ALTER TABLE "sale_submissions" ADD COLUMN "remitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sale_submissions" ADD COLUMN "remitted_by_name" text;
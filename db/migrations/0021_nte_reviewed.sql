ALTER TABLE "notices_to_explain" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notices_to_explain" ADD COLUMN "reviewed_by_name" text;
ALTER TABLE "notices_to_explain" ADD COLUMN "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notices_to_explain" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "notices_to_explain" ADD COLUMN "explained_at" timestamp with time zone;
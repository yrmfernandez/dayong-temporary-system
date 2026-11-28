ALTER TABLE "clearings" ADD COLUMN "handover_lines" jsonb;--> statement-breakpoint
ALTER TABLE "clearings" ADD COLUMN "handover_note" text;--> statement-breakpoint
ALTER TABLE "clearings" ADD COLUMN "handover_closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clearings" ADD COLUMN "handover_variance_id" text;
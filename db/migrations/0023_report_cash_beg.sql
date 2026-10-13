ALTER TABLE "report_notes" ADD COLUMN "cash_beg" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "report_notes" ADD COLUMN "cash_beg_reason" text;--> statement-breakpoint
ALTER TABLE "report_notes" ADD COLUMN "cash_beg_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "report_notes" ADD COLUMN "cash_beg_updated_by" text;
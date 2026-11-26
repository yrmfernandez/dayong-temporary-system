ALTER TABLE "deceased_claims" ADD COLUMN "review_status" text DEFAULT 'Pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "reviewed_by_employee_id" text;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "reviewed_by_name" text;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "member_status_before" text;--> statement-breakpoint
ALTER TABLE "deceased_claims" ADD COLUMN "member_died_on_before" date;--> statement-breakpoint
CREATE INDEX "deceased_claims_review_idx" ON "deceased_claims" USING btree ("review_status","status");
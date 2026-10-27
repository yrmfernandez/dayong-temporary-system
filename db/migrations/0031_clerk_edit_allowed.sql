ALTER TABLE "daily_audits" ADD COLUMN "clerk_edit_allowed_by_name" text;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "clerk_edit_allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "clerk_edit_reason" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "clerk_edit_allowed_by_name" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "clerk_edit_allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "clerk_edit_reason" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "clerk_edit_allowed_by_name" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "clerk_edit_allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "clerk_edit_reason" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "clerk_edit_allowed_by_name" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "clerk_edit_allowed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "clerk_edit_reason" text;
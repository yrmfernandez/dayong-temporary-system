ALTER TABLE "daily_audits" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "month_label" text;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "submission" text;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "returned_by_name" text;--> statement-breakpoint
ALTER TABLE "daily_audits" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "month_label" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "submission" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "returned_by_name" text;--> statement-breakpoint
ALTER TABLE "monthly_audits" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "month_label" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "submission" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "returned_by_name" text;--> statement-breakpoint
ALTER TABLE "weekly_audits" ADD COLUMN "return_reason" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "month_label" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "submission" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "submitted_by_name" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "returned_by_name" text;--> statement-breakpoint
ALTER TABLE "yearly_audits" ADD COLUMN "return_reason" text;
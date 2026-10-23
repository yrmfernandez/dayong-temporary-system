ALTER TABLE "collections" ADD COLUMN "incentive_decision" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "incentive_decision_reason" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "incentive_decision_by" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "incentive_decision_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "incentive_decision" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "incentive_decision_reason" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "incentive_decision_by" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "incentive_decision_at" timestamp with time zone;
ALTER TABLE "collections" ADD COLUMN "different_incentive_type" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "different_incentive_amount" numeric(12, 2);--> statement-breakpoint
-- Different incentives move from Programs to the collection (owner, November 9, 2026). A collection already ticked keeps
-- the rate its program's Different period gave the NOP it starts at; one with no such period is no longer ticked.
UPDATE "collections" c SET "different_incentive_type" = i."incentive_type", "different_incentive_amount" = i."incentive_amount"
FROM "program_incentives" i
WHERE c."different_incentive" AND i."different" AND i."role" = 'MAS' AND i."program_id" = c."program_id"
  AND c."nop_from" BETWEEN i."from_month" AND i."to_month";--> statement-breakpoint
UPDATE "collections" SET "different_incentive" = false WHERE "different_incentive" AND "different_incentive_type" IS NULL;--> statement-breakpoint
DELETE FROM "program_incentives" WHERE "different";

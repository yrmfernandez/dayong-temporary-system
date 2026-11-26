CREATE TABLE "inventory_items" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "inventory_items_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"item_id" text PRIMARY KEY NOT NULL,
	"employee_id" text NOT NULL,
	"employee_name" text,
	"branch" text NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit" text,
	"condition" text DEFAULT 'Good' NOT NULL,
	"min_quantity" integer,
	"unit_cost" numeric(12, 2),
	"note" text,
	"last_checked_on" date,
	"status" text DEFAULT 'Active' NOT NULL,
	"removed_reason" text,
	"removed_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "inventory_items_clerk_idx" ON "inventory_items" USING btree ("employee_id","status");--> statement-breakpoint
CREATE INDEX "inventory_items_branch_idx" ON "inventory_items" USING btree ("branch");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
SELECT attach_change_triggers();
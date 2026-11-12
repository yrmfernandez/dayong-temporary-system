CREATE TABLE "system_update_views" (
	"update_id" text NOT NULL,
	"user_id" text NOT NULL,
	"seen_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	CONSTRAINT "system_update_views_update_id_user_id_pk" PRIMARY KEY("update_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "system_update_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system_updates" (
	"row_seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "system_updates_row_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"update_id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"steps" jsonb,
	"audience" jsonb,
	"status" text DEFAULT 'Draft' NOT NULL,
	"announced_at" timestamp with time zone,
	"announced_by_name" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"encoded_by_user_id" text,
	"encoded_by_employee_id" text,
	"encoded_by_name" text,
	"encoded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "system_updates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "system_update_views" ADD CONSTRAINT "system_update_views_update_id_system_updates_update_id_fk" FOREIGN KEY ("update_id") REFERENCES "public"."system_updates"("update_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_update_views" ADD CONSTRAINT "system_update_views_user_id_users_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "system_updates_status_idx" ON "system_updates" USING btree ("status","announced_at");--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint
-- Who saw an update is not worth an Audit Log row each time.
DROP TRIGGER IF EXISTS audit_row_change ON "system_update_views";--> statement-breakpoint
-- Live updates for the new tables (0010_realtime_changes.sql): an announced update pops up within seconds.
SELECT attach_change_triggers();

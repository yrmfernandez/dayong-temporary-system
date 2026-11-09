CREATE INDEX "audit_log_row_seq_idx" ON "audit_log" USING btree ("row_seq");--> statement-breakpoint
CREATE INDEX "collections_or_key_posted_idx" ON "collections" USING btree ("or_key","row_seq") WHERE "collections"."status" = 'Posted';--> statement-breakpoint
CREATE INDEX "sales_application_key_idx" ON "sales" USING btree ("application_key","row_seq");
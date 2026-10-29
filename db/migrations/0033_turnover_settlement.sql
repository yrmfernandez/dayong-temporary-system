ALTER TABLE "turnover_variances" ADD COLUMN "settlement" text;--> statement-breakpoint
ALTER TABLE "turnover_variances" ADD COLUMN "settled_cash" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "turnover_variances" ADD COLUMN "settled_on" date;--> statement-breakpoint
CREATE INDEX "turnover_variances_encoder_idx" ON "turnover_variances" USING btree ("encoded_by_employee_id","encoded_at");
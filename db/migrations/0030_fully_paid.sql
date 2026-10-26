ALTER TABLE "branches" ADD COLUMN "certificate_prefix" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "fully_paid_on" date;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "fully_paid_total" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "fully_paid_source" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "fully_paid_recorded_by" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "certificate_number" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "certificate_status" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "certificate_released_on" date;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "certificate_released_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "member_programs_certificate_key" ON "member_programs" USING btree ("certificate_number") WHERE "member_programs"."certificate_number" is not null;--> statement-breakpoint
-- Certificate prefixes from the certificates already issued (DSRDPI Fully Paid form): DAVAO for the Davao City branches,
-- DAVNOR for La Filipina, Maco and Tagum, DDO for Compostela, Maragusan, Mawab, Nabunturan and Pantukan, SDS for
-- Hinatuan; branches without a certificate yet follow their territory (METRO DAVAO → DAVAO, DDO → DDO, DAVNOR → DAVNOR,
-- SURIGAO → SDS). Others stay blank until set on the Fully Paid page. Not logged as edits.
ALTER TABLE branches DISABLE TRIGGER audit_row_change;--> statement-breakpoint
UPDATE branches SET certificate_prefix = CASE
    WHEN upper(trim(branch_name_code)) IN ('AGDAO', 'BUHANGIN', 'CALINAN', 'MATINA', 'MINTAL', 'STA. CRUZ', 'TIBUNGCO', 'TORIL') THEN 'DAVAO'
    WHEN upper(trim(branch_name_code)) IN ('LA FILIPINA', 'MACO', 'TAGUM') THEN 'DAVNOR'
    WHEN upper(trim(branch_name_code)) IN ('COMPOSTELA', 'MARAGUSAN', 'MAWAB', 'NABUNTURAN', 'PANTUKAN') THEN 'DDO'
    WHEN upper(trim(branch_name_code)) = 'HINATUAN' THEN 'SDS'
    WHEN upper(coalesce(territory, '')) LIKE 'METRO DAVAO%' THEN 'DAVAO'
    WHEN upper(coalesce(territory, '')) LIKE 'DDO%' THEN 'DDO'
    WHEN upper(coalesce(territory, '')) = 'DAVNOR' THEN 'DAVNOR'
    WHEN upper(coalesce(territory, '')) = 'SURIGAO' THEN 'SDS'
    ELSE NULL END
  WHERE certificate_prefix IS NULL;--> statement-breakpoint
ALTER TABLE branches ENABLE TRIGGER audit_row_change;--> statement-breakpoint
-- The account status "Paid" is now "Fully Paid" (owner, October 27, 2026).
ALTER TABLE member_programs DISABLE TRIGGER audit_row_change;--> statement-breakpoint
UPDATE member_programs SET account_status = 'Fully Paid' WHERE account_status = 'Paid';--> statement-breakpoint
ALTER TABLE member_programs ENABLE TRIGGER audit_row_change;

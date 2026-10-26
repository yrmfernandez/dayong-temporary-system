ALTER TABLE "member_programs" ADD COLUMN "forfeit_held" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Forfeited carried from the old system (owner, October 26, 2026: PH-73684484 stayed Forfeited after its receipts were
-- corrected). A stored Forfeited used to hold whatever the receipts said, so once the app itself stored Forfeited (the
-- nightly job, a recalculation) no correction could reopen the account. Only a forfeit the app never worked out holds
-- now: accounts stored Forfeited with no Audit Log entry changing their status to Forfeited. Not logged as edits.
ALTER TABLE member_programs DISABLE TRIGGER audit_row_change;--> statement-breakpoint
UPDATE member_programs mp SET forfeit_held = true
  WHERE mp.account_status = 'Forfeited'
    AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.table_name = 'member_programs' AND a.record_id = mp.enrollment_id
      AND a.changes_json -> 'account_status' ->> 'to' = 'Forfeited');--> statement-breakpoint
ALTER TABLE member_programs ENABLE TRIGGER audit_row_change;

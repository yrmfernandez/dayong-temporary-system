ALTER TABLE "employee_branches" ADD COLUMN "officer_duty" boolean DEFAULT true NOT NULL;--> statement-breakpoint
-- The MAS-Officer role (owner, November 16, 2026): a MAS who reports on the MAS of their branch (MAS Report).
-- Added only when no role of that name exists; default pages until an administrator sets them on the Roles page.
INSERT INTO "roles" ("role_id", "role_name", "description", "manage_users", "manage_attendance", "view_attendance_reports", "status", "encoded_by_name", "encoded_at")
SELECT 'ROLE-MAS-OFFICER', 'MAS-Officer', 'A MAS who heads the MAS of a branch: sees their MAS Report', false, false, false, 'active', 'MAS-Officer role setup', now()
WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE lower(regexp_replace(trim("role_name"), '[[:space:]-]+', ' ', 'g')) = 'mas officer' OR "role_id" = 'ROLE-MAS-OFFICER');

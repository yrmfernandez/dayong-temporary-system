-- Declared non-working days are attendance rows of no employee (the app's "SYSTEM"). The employee link refused them
-- (no employee SYSTEM), so declaring one failed; the calendar's rows now keep employee_id empty (November 2, 2026).
ALTER TABLE "attendance" ALTER COLUMN "employee_id" DROP NOT NULL;

ALTER TABLE "member_programs" ADD COLUMN "collector_employee_id" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD CONSTRAINT "member_programs_collector_employee_id_employees_employee_id_fk" FOREIGN KEY ("collector_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "member_programs_collector_idx" ON "member_programs" USING btree ("collector_employee_id");--> statement-breakpoint
-- Each account starts with the Collector Members showed until now: the one on its latest posted Collector collection,
-- when that is an active employee (by link, else by a name only one active employee has). Otherwise it stays blank.
WITH latest AS (
  SELECT DISTINCT ON (trim(c.member_number), c.program_id) trim(c.member_number) AS member_number, c.program_id,
    trim(c.accountable_name) AS person, c.accountable_employee_id AS employee_id
  FROM collections c
  WHERE c.status = 'Posted' AND c.collected_by_role = 'Collector' AND coalesce(trim(c.accountable_name), '') <> ''
  ORDER BY trim(c.member_number), c.program_id, c.or_date DESC NULLS LAST, c.row_seq DESC
), active AS (
  SELECT employee_id, lower(regexp_replace(trim(full_name), '[[:space:]]+', ' ', 'g')) AS name
  FROM employees WHERE lower(trim(employment_status)) = 'active'
), by_name AS (
  SELECT name, min(employee_id) AS employee_id FROM active GROUP BY name HAVING count(*) = 1
), assigned AS (
  SELECT mp.enrollment_id, coalesce(linked.employee_id, named.employee_id) AS employee_id
  FROM member_programs mp
  JOIN members m ON m.member_id = mp.member_id
  JOIN latest l ON l.member_number = coalesce(nullif(trim(m.member_number), ''), trim(mp.member_number)) AND l.program_id = mp.program_id
  LEFT JOIN active linked ON linked.employee_id = l.employee_id
  LEFT JOIN by_name named ON l.employee_id IS NULL AND named.name = lower(regexp_replace(l.person, '[[:space:]]+', ' ', 'g'))
)
UPDATE member_programs mp SET collector_employee_id = a.employee_id
FROM assigned a WHERE a.enrollment_id = mp.enrollment_id AND a.employee_id IS NOT NULL;

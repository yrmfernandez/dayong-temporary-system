-- Renaming an employee rewrote their collections twice (MAS name, then accountable name). Every collection row rewrite
-- runs its link trigger, so a MAS with a few thousand collections took 6-7 seconds to rename (and the Employees save
-- looked stuck). Both names now change in one pass over collections: 6.4 s → 1.0 s for 3,586 collections on staging
-- (October 8, 2026). Same result otherwise; only cascade_employee_rename() changes.
CREATE OR REPLACE FUNCTION cascade_employee_rename() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_name text := lower(trim(OLD.full_name));
  new_name text := trim(NEW.full_name);
  emp_id text := NEW.employee_id;
  by_name boolean;
BEGIN
  IF lower(trim(NEW.full_name)) = old_name THEN RETURN NULL; END IF;
  -- Name-only copies are renamed only when the old name was this employee's alone.
  by_name := old_name <> '' AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.employee_id <> emp_id AND lower(trim(e.full_name)) = old_name);
  PERFORM set_config('app.link_sync', 'on', true);
  -- One pass over collections for both names: each collection row rewrite runs its link trigger, so two passes cost twice.
  UPDATE collections SET
    mas = CASE WHEN mas_employee_id = emp_id OR (by_name AND mas_employee_id IS NULL AND lower(trim(mas)) = old_name) THEN new_name ELSE mas END,
    accountable_name = CASE WHEN accountable_employee_id = emp_id AND lower(trim(accountable_name)) = old_name THEN new_name ELSE accountable_name END
  WHERE mas_employee_id = emp_id OR (by_name AND mas_employee_id IS NULL AND lower(trim(mas)) = old_name)
     OR (accountable_employee_id = emp_id AND lower(trim(accountable_name)) = old_name);
  UPDATE bank_deposits SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE commissions SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE fidelity SET mas_name = new_name WHERE mas_employee_id = emp_id;
  UPDATE payroll_lines SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE sale_submissions SET mas = new_name WHERE mas_employee_id = emp_id;
  UPDATE member_transfers SET to_mas = new_name WHERE to_employee_id = emp_id;
  UPDATE users SET full_name = new_name WHERE employee_id = emp_id;
  UPDATE member_transfers SET from_mas = new_name WHERE from_employee_id = emp_id;
  UPDATE member_programs SET mas = new_name WHERE mas_employee_id = emp_id;
  UPDATE sales SET mas = new_name WHERE mas_employee_id = emp_id;
  UPDATE remittances SET mas = new_name WHERE mas_employee_id = emp_id;
  UPDATE bank_deposits SET mas = new_name WHERE mas_employee_id = emp_id;
  IF by_name THEN
    UPDATE collections SET original_mas = new_name WHERE lower(trim(original_mas)) = old_name;
    UPDATE member_programs SET mas = new_name WHERE lower(trim(mas)) = old_name;
    UPDATE sales SET mas = new_name WHERE lower(trim(mas)) = old_name;
    UPDATE remittances SET mas = new_name WHERE lower(trim(mas)) = old_name;
    UPDATE bank_deposits SET mas = new_name WHERE lower(trim(mas)) = old_name;
    UPDATE member_transfers SET from_mas = new_name WHERE lower(trim(from_mas)) = old_name;
  END IF;
  PERFORM set_config('app.link_sync', '', true);
  RETURN NULL;
END;
$$;

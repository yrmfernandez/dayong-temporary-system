-- Renames follow everywhere (phase 2 of linked tables, step 3). Records keep a copy of the branch or MAS name for
-- display and for the older position-based code; when a branch or employee is renamed, the database now updates every
-- copy in the same transaction, so lists, reports and the Collections rule "use the enrollment's Branch and MAS" keep
-- working. Copies with an ID beside them are matched by ID. Copies without one are matched by the old name: always for
-- branches (names are unique), and for employees only when no other employee has that old name. The rename itself is
-- in the Audit Log once; the copied names are not logged row by row.

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  old_row jsonb := to_jsonb(OLD);
  new_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END;
  changes jsonb := '{}'::jsonb;
  record_key text := '';
  key text;
  column_name text;
BEGIN
  -- A rename copied onto other records (cascade_*_rename below) is logged once, on the renamed employee or branch.
  IF current_setting('app.link_sync', true) = 'on' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  -- Trigger arguments are the table's primary-key columns; a composite key is joined with ':'.
  FOREACH key IN ARRAY TG_ARGV LOOP
    record_key := record_key || CASE WHEN record_key = '' THEN '' ELSE ':' END || coalesce(old_row ->> key, '');
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    FOR column_name IN SELECT jsonb_object_keys(new_row) LOOP
      IF (old_row -> column_name) IS DISTINCT FROM (new_row -> column_name) THEN
        changes := changes || jsonb_build_object(column_name, jsonb_build_object('from', old_row -> column_name, 'to', new_row -> column_name));
      END IF;
    END LOOP;
    IF changes = '{}'::jsonb THEN RETURN NEW; END IF;
  ELSE
    changes := old_row;
  END IF;

  INSERT INTO audit_log (action, table_name, record_id, changes_json, user_id, employee_id, user_name)
  VALUES (
    CASE WHEN TG_OP = 'UPDATE' THEN 'update' ELSE 'delete' END,
    TG_TABLE_NAME,
    record_key,
    changes,
    nullif(current_setting('app.user_id', true), ''),
    nullif(current_setting('app.employee_id', true), ''),
    nullif(current_setting('app.user_name', true), '')
  );
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION cascade_branch_rename() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  old_name text := lower(trim(OLD.branch_name_code));
  new_name text := trim(NEW.branch_name_code);
BEGIN
  IF lower(trim(NEW.branch_name_code)) = old_name THEN RETURN NULL; END IF;
  PERFORM set_config('app.link_sync', 'on', true);
  UPDATE collections SET branch = new_name WHERE branch_id = NEW.branch_id OR (branch_id IS NULL AND lower(trim(branch)) = old_name);
  UPDATE attendance SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE bank_deposits SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE cash_transactions SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE expenses SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE member_programs SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE member_transfers SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE payroll_runs SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE remittances SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE sale_submissions SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE sales SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE vendor_payables SET branch = new_name WHERE lower(trim(branch)) = old_name;
  UPDATE employees SET primary_branch = new_name WHERE lower(trim(primary_branch)) = old_name;
  PERFORM set_config('app.link_sync', '', true);
  RETURN NULL;
END;
$$;--> statement-breakpoint

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
  UPDATE collections SET mas = new_name WHERE mas_employee_id = emp_id OR (by_name AND mas_employee_id IS NULL AND lower(trim(mas)) = old_name);
  UPDATE collections SET accountable_name = new_name WHERE accountable_employee_id = emp_id AND lower(trim(accountable_name)) = old_name;
  UPDATE bank_deposits SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE commissions SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE fidelity SET mas_name = new_name WHERE mas_employee_id = emp_id;
  UPDATE payroll_lines SET employee_name = new_name WHERE employee_id = emp_id;
  UPDATE sale_submissions SET mas = new_name WHERE mas_employee_id = emp_id;
  UPDATE member_transfers SET to_mas = new_name WHERE to_employee_id = emp_id;
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
$$;--> statement-breakpoint

-- Named to run after audit_row_change (triggers on one table fire in name order), so the rename is logged first.
DROP TRIGGER IF EXISTS cascade_branch_rename ON branches;--> statement-breakpoint
CREATE TRIGGER cascade_branch_rename AFTER UPDATE OF branch_name_code ON branches FOR EACH ROW EXECUTE FUNCTION cascade_branch_rename();--> statement-breakpoint
DROP TRIGGER IF EXISTS cascade_employee_rename ON employees;--> statement-breakpoint
CREATE TRIGGER cascade_employee_rename AFTER UPDATE OF full_name ON employees FOR EACH ROW EXECUTE FUNCTION cascade_employee_rename();--> statement-breakpoint

-- A renamed collection keeps its link while the name still belongs to the linked record, even if another employee
-- shares the new name.
CREATE OR REPLACE FUNCTION fill_collection_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.branch IS DISTINCT FROM OLD.branch OR NEW.branch_id IS NULL THEN
    IF NOT (NEW.branch_id IS NOT NULL AND EXISTS (SELECT 1 FROM branches b WHERE b.branch_id = NEW.branch_id AND lower(trim(b.branch_name_code)) = lower(trim(NEW.branch)))) THEN
      NEW.branch_id := link_branch_id(NEW.branch);
    END IF;
  END IF;
  IF TG_OP = 'INSERT' OR NEW.mas IS DISTINCT FROM OLD.mas OR NEW.branch IS DISTINCT FROM OLD.branch OR NEW.mas_employee_id IS NULL THEN
    IF NOT (NEW.mas_employee_id IS NOT NULL AND EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = NEW.mas_employee_id AND lower(trim(e.full_name)) = lower(trim(NEW.mas)))) THEN
      NEW.mas_employee_id := link_employee_id(NEW.mas, NEW.branch_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION cascade_branch_rename(), cascade_employee_rename(), audit_row_change() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

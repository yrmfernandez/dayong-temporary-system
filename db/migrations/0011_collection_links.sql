ALTER TABLE "collections" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "collections_branch_id_idx" ON "collections" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "collections_mas_employee_idx" ON "collections" USING btree ("mas_employee_id");--> statement-breakpoint

-- Phase 2 of linked tables: a collection links to its branch and MAS by ID. The database fills the IDs from the branch
-- and mas names on every insert, and on an update that changes a name, so the app, the Sheets layer and scripts are
-- all covered without changes. A name that matches no record leaves the ID empty. Matching ignores case and outer
-- spaces; if two employees share a name, the one assigned to the collection's branch is used.
CREATE OR REPLACE FUNCTION link_branch_id(branch_name text) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT b.branch_id FROM branches b WHERE lower(trim(b.branch_name_code)) = lower(trim(branch_name)) LIMIT 1
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION link_employee_id(employee_name text, at_branch text) RETURNS text
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT e.employee_id FROM employees e
  WHERE lower(trim(e.full_name)) = lower(trim(employee_name))
  ORDER BY EXISTS (SELECT 1 FROM employee_branches eb WHERE eb.employee_id = e.employee_id AND eb.branch_id = at_branch) DESC, e.employee_id
  LIMIT 1
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION fill_collection_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.branch IS DISTINCT FROM OLD.branch OR NEW.branch_id IS NULL THEN
    NEW.branch_id := link_branch_id(NEW.branch);
  END IF;
  IF TG_OP = 'INSERT' OR NEW.mas IS DISTINCT FROM OLD.mas OR NEW.branch IS DISTINCT FROM OLD.branch OR NEW.mas_employee_id IS NULL THEN
    NEW.mas_employee_id := link_employee_id(NEW.mas, NEW.branch_id);
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS fill_collection_links ON collections;--> statement-breakpoint
CREATE TRIGGER fill_collection_links BEFORE INSERT OR UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION fill_collection_links();--> statement-breakpoint

-- When an employee or branch is added or renamed, collections still waiting for a link under that name get it.
CREATE OR REPLACE FUNCTION link_waiting_collections() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'employees' THEN
    UPDATE collections SET mas_employee_id = NEW.employee_id WHERE mas_employee_id IS NULL AND lower(trim(mas)) = lower(trim(NEW.full_name));
  ELSE
    UPDATE collections SET branch_id = NEW.branch_id WHERE branch_id IS NULL AND lower(trim(branch)) = lower(trim(NEW.branch_name_code));
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS link_waiting_collections ON employees;--> statement-breakpoint
CREATE TRIGGER link_waiting_collections AFTER INSERT OR UPDATE OF full_name ON employees FOR EACH ROW EXECUTE FUNCTION link_waiting_collections();--> statement-breakpoint
DROP TRIGGER IF EXISTS link_waiting_collections ON branches;--> statement-breakpoint
CREATE TRIGGER link_waiting_collections AFTER INSERT OR UPDATE OF branch_name_code ON branches FOR EACH ROW EXECUTE FUNCTION link_waiting_collections();--> statement-breakpoint

-- Existing rows, once. The audit trigger is paused so 60,000 link fills are not logged as edits.
ALTER TABLE collections DISABLE TRIGGER audit_row_change;--> statement-breakpoint
UPDATE collections SET branch_id = link_branch_id(branch) WHERE branch_id IS NULL;--> statement-breakpoint
UPDATE collections SET mas_employee_id = link_employee_id(mas, branch_id) WHERE mas_employee_id IS NULL;--> statement-breakpoint
ALTER TABLE collections ENABLE TRIGGER audit_row_change;--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION link_branch_id(text), link_employee_id(text, text), fill_collection_links(), link_waiting_collections() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

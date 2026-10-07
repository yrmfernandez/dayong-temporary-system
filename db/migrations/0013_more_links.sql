ALTER TABLE "attendance" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD COLUMN "mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "member_programs" ADD COLUMN "mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD COLUMN "from_employee_id" text;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "remittances" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "remittances" ADD COLUMN "mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "mas_employee_id" text;--> statement-breakpoint
ALTER TABLE "vendor_payables" ADD COLUMN "branch_id" text;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "bank_deposits" ADD CONSTRAINT "bank_deposits_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "cash_transactions" ADD CONSTRAINT "cash_transactions_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_programs" ADD CONSTRAINT "member_programs_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_programs" ADD CONSTRAINT "member_programs_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD CONSTRAINT "member_transfers_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "member_transfers" ADD CONSTRAINT "member_transfers_from_employee_id_employees_employee_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "remittances" ADD CONSTRAINT "remittances_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_mas_employee_id_employees_employee_id_fk" FOREIGN KEY ("mas_employee_id") REFERENCES "public"."employees"("employee_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "vendor_payables" ADD CONSTRAINT "vendor_payables_branch_id_branches_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("branch_id") ON DELETE no action ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "attendance_branch_id_idx" ON "attendance" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "bank_deposits_branch_id_idx" ON "bank_deposits" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "bank_deposits_mas_employee_id_idx" ON "bank_deposits" USING btree ("mas_employee_id");--> statement-breakpoint
CREATE INDEX "cash_transactions_branch_id_idx" ON "cash_transactions" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "expenses_branch_id_idx" ON "expenses" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "member_programs_branch_id_idx" ON "member_programs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "member_programs_mas_employee_id_idx" ON "member_programs" USING btree ("mas_employee_id");--> statement-breakpoint
CREATE INDEX "member_transfers_branch_id_idx" ON "member_transfers" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "member_transfers_from_employee_id_idx" ON "member_transfers" USING btree ("from_employee_id");--> statement-breakpoint
CREATE INDEX "payroll_runs_branch_id_idx" ON "payroll_runs" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "remittances_branch_id_idx" ON "remittances" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "remittances_mas_employee_id_idx" ON "remittances" USING btree ("mas_employee_id");--> statement-breakpoint
CREATE INDEX "sales_branch_id_idx" ON "sales" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "sales_mas_employee_id_idx" ON "sales" USING btree ("mas_employee_id");--> statement-breakpoint
CREATE INDEX "vendor_payables_branch_id_idx" ON "vendor_payables" USING btree ("branch_id");--> statement-breakpoint

-- Phase 2 of linked tables for the remaining tables (collections came first, migration 0011). One trigger function
-- serves every table: its arguments name the branch text column, the branch link, the MAS text column and the MAS link
-- ('' when the table has none). Same rules as collections: filled on insert and when a name changes, the current link
-- kept while its record still has that name, empty when the name matches no record (or is blank).
CREATE OR REPLACE FUNCTION fill_links() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  cur jsonb := to_jsonb(NEW);
  old_row jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  branch_col text := TG_ARGV[0]; branch_link text := TG_ARGV[1];
  mas_col text := TG_ARGV[2]; mas_link text := TG_ARGV[3];
  b_id text; m_id text; changes jsonb := '{}'::jsonb;
BEGIN
  IF branch_link <> '' THEN
    b_id := cur ->> branch_link;
    IF TG_OP = 'INSERT' OR (old_row ->> branch_col) IS DISTINCT FROM (cur ->> branch_col) OR b_id IS NULL THEN
      IF NOT (b_id IS NOT NULL AND EXISTS (SELECT 1 FROM branches b WHERE b.branch_id = b_id AND lower(trim(b.branch_name_code)) = lower(trim(cur ->> branch_col)))) THEN
        b_id := link_branch_id(cur ->> branch_col);
        changes := changes || jsonb_build_object(branch_link, b_id);
      END IF;
    END IF;
  END IF;
  IF mas_link <> '' THEN
    m_id := cur ->> mas_link;
    IF TG_OP = 'INSERT' OR (old_row ->> mas_col) IS DISTINCT FROM (cur ->> mas_col) OR m_id IS NULL THEN
      IF NOT (m_id IS NOT NULL AND EXISTS (SELECT 1 FROM employees e WHERE e.employee_id = m_id AND lower(trim(e.full_name)) = lower(trim(cur ->> mas_col)))) THEN
        changes := changes || jsonb_build_object(mas_link, link_employee_id(cur ->> mas_col, b_id));
      END IF;
    END IF;
  END IF;
  IF changes <> '{}'::jsonb THEN NEW := jsonb_populate_record(NEW, changes); END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint

-- The linked tables: table, branch text, branch link, MAS text, MAS link.
CREATE OR REPLACE FUNCTION link_targets() RETURNS TABLE (table_name text, branch_col text, branch_link text, mas_col text, mas_link text)
LANGUAGE sql IMMUTABLE AS $$
  VALUES ('attendance', 'branch', 'branch_id', '', ''), ('bank_deposits', 'branch', 'branch_id', 'mas', 'mas_employee_id'),
         ('cash_transactions', 'branch', 'branch_id', '', ''), ('expenses', 'branch', 'branch_id', '', ''),
         ('member_programs', 'branch', 'branch_id', 'mas', 'mas_employee_id'), ('member_transfers', 'branch', 'branch_id', 'from_mas', 'from_employee_id'),
         ('payroll_runs', 'branch', 'branch_id', '', ''), ('remittances', 'branch', 'branch_id', 'mas', 'mas_employee_id'),
         ('sales', 'branch', 'branch_id', 'mas', 'mas_employee_id'), ('vendor_payables', 'branch', 'branch_id', '', ''),
         ('collections', 'branch', 'branch_id', 'mas', 'mas_employee_id')
$$;--> statement-breakpoint

-- Attach (collections keeps its own trigger from migration 0011) and fill existing rows once, with the audit trigger
-- paused so link fills are not logged as edits.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM link_targets() WHERE table_name <> 'collections' LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fill_links ON %I', t.table_name);
    EXECUTE format('CREATE TRIGGER fill_links BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION fill_links(%L, %L, %L, %L)', t.table_name, t.branch_col, t.branch_link, t.mas_col, t.mas_link);
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER audit_row_change', t.table_name);
    EXECUTE format('UPDATE %I SET %I = link_branch_id(%I) WHERE %I IS NULL AND trim(coalesce(%I, %L)) <> %L', t.table_name, t.branch_link, t.branch_col, t.branch_link, t.branch_col, '', '');
    IF t.mas_link <> '' THEN
      EXECUTE format('UPDATE %I SET %I = link_employee_id(%I, %I) WHERE %I IS NULL AND trim(coalesce(%I, %L)) <> %L', t.table_name, t.mas_link, t.mas_col, t.branch_link, t.mas_link, t.mas_col, '', '');
    END IF;
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER audit_row_change', t.table_name);
  END LOOP;
END;
$$;--> statement-breakpoint

-- A newly added or renamed employee or branch links every row still waiting under that name, in all linked tables.
CREATE OR REPLACE FUNCTION link_waiting_collections() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT * FROM link_targets() LOOP
    IF TG_TABLE_NAME = 'employees' AND t.mas_link <> '' THEN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I IS NULL AND lower(trim(%I)) = lower(trim($2))', t.table_name, t.mas_link, t.mas_link, t.mas_col) USING NEW.employee_id, NEW.full_name;
    ELSIF TG_TABLE_NAME = 'branches' THEN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I IS NULL AND lower(trim(%I)) = lower(trim($2))', t.table_name, t.branch_link, t.branch_link, t.branch_col) USING NEW.branch_id, NEW.branch_name_code;
    END IF;
  END LOOP;
  RETURN NULL;
END;
$$;--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION fill_links(), link_targets(), link_waiting_collections() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;
--> statement-breakpoint

-- Every copy follows an edit. Employee renames now also update the login account's name and use the new links.
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
$$;--> statement-breakpoint

-- A member's details are copied onto their New Sale records (sales), and the member number onto enrollments,
-- collections, transfers and sales. Editing the member updates every copy in the same transaction; it is one Audit
-- Log entry on the member. Amounts copied at enrollment (registration amount, amount paid) are what was agreed then and
-- are not changed by later program edits.
CREATE OR REPLACE FUNCTION cascade_member_change() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF ROW(NEW.member_number, NEW.surname, NEW.first_name, NEW.middle_name, NEW.name_extension, NEW.birthdate, NEW.birthplace, NEW.gender,
         NEW.civil_status, NEW.member_contact, NEW.address, NEW.claimant_name, NEW.claimant_contact, NEW.claimant_same_address, NEW.claimant_address)
     IS NOT DISTINCT FROM
     ROW(OLD.member_number, OLD.surname, OLD.first_name, OLD.middle_name, OLD.name_extension, OLD.birthdate, OLD.birthplace, OLD.gender,
         OLD.civil_status, OLD.member_contact, OLD.address, OLD.claimant_name, OLD.claimant_contact, OLD.claimant_same_address, OLD.claimant_address)
  THEN RETURN NULL; END IF;
  PERFORM set_config('app.link_sync', 'on', true);
  UPDATE sales SET member_number = NEW.member_number, surname = NEW.surname, first_name = NEW.first_name, middle_name = NEW.middle_name,
    name_extension = NEW.name_extension, birthdate = NEW.birthdate, birthplace = NEW.birthplace, gender = NEW.gender, civil_status = NEW.civil_status,
    member_contact = NEW.member_contact, address = NEW.address, claimant_name = NEW.claimant_name, claimant_contact = NEW.claimant_contact,
    claimant_same_address = NEW.claimant_same_address, claimant_address = NEW.claimant_address
  WHERE member_number = OLD.member_number AND OLD.member_number IS NOT NULL AND OLD.member_number <> '';
  IF NEW.member_number IS DISTINCT FROM OLD.member_number THEN
    UPDATE member_programs SET member_number = NEW.member_number WHERE member_id = NEW.member_id;
    UPDATE collections SET member_number = NEW.member_number WHERE member_id = NEW.member_id;
    UPDATE member_transfers SET member_number = NEW.member_number WHERE member_number = OLD.member_number;
  END IF;
  PERFORM set_config('app.link_sync', '', true);
  RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS cascade_member_change ON members;--> statement-breakpoint
CREATE TRIGGER cascade_member_change AFTER UPDATE ON members FOR EACH ROW EXECUTE FUNCTION cascade_member_change();--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION cascade_member_change(), cascade_employee_rename() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

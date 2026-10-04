-- Audit Log: every UPDATE and DELETE on an application table is recorded in audit_log, the same events the Sheets
-- wrapper logged (lib/audit-log.ts). Inserts are creations and are not logged. The app names the acting user for each
-- transaction with set_config('app.user_id' | 'app.employee_id' | 'app.user_name', value, true); writes made outside
-- the app (scripts, the SQL editor) are logged with a blank user.

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

-- Attach the trigger to every application table except audit_log itself, passing its primary-key columns. Safe to
-- rerun: a migration that adds a table ends with SELECT attach_audit_triggers();
CREATE OR REPLACE FUNCTION attach_audit_triggers() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name,
           string_agg(quote_literal(a.attname), ', ' ORDER BY array_position(i.indkey, a.attnum)) AS key_columns
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
    WHERE c.relkind = 'r' AND c.relname <> 'audit_log'
    GROUP BY c.relname
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS audit_row_change ON %I', target.table_name);
    EXECUTE format('CREATE TRIGGER audit_row_change AFTER UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION audit_row_change(%s)', target.table_name, target.key_columns);
  END LOOP;
END;
$$;--> statement-breakpoint
SELECT attach_audit_triggers();--> statement-breakpoint

-- Supabase's public API roles get no access to application tables (row-level security already blocks them; this is a
-- second lock). The app connects as the database owner, which these statements do not affect.
DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', api_role);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION audit_row_change(), attach_audit_triggers() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

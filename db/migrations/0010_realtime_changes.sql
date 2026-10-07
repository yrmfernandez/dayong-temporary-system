-- Live updates: after any statement that inserts, updates or deletes rows in an application table, a small message is
-- broadcast on the public Supabase Realtime channel "db-changes" (event "change") naming only the table, e.g.
-- {"table":"collections"}. Open pages listen (lib/use-live-refresh.ts) and reload their data through the app's own
-- routes, which check each user's access, so no record ever travels on the channel. The message is sent when the
-- transaction commits; a rolled-back save sends nothing.
--
-- One message per statement, not per row, so a batch of 50 collections sends one. Outside Supabase (PGlite in the
-- tests) there is no realtime schema and the function does nothing. A failure to broadcast never blocks a save.

CREATE OR REPLACE FUNCTION notify_table_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT realtime.send($1, $2, $3, $4)' USING jsonb_build_object('table', TG_TABLE_NAME), 'change', 'db-changes', false;
    EXCEPTION WHEN OTHERS THEN
      NULL; -- live updates are a convenience; the save itself must succeed
    END;
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Attach to every application table except audit_log (it changes with every update, which already broadcasts).
-- Safe to rerun: a migration that adds a table ends with SELECT attach_change_triggers();
CREATE OR REPLACE FUNCTION attach_change_triggers() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  FOR target IN
    SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE c.relkind = 'r' AND c.relname <> 'audit_log'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS notify_table_change ON %I', target.table_name);
    EXECUTE format('CREATE TRIGGER notify_table_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION notify_table_change()', target.table_name);
  END LOOP;
END;
$$;--> statement-breakpoint
SELECT attach_change_triggers();--> statement-breakpoint

DO $$
DECLARE
  api_role text;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = api_role) THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION notify_table_change(), attach_change_triggers() FROM %I', api_role);
    END IF;
  END LOOP;
END;
$$;

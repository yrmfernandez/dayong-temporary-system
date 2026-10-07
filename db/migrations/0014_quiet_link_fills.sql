-- Linking rows that were waiting for a newly registered employee or branch is bookkeeping, not an edit: it is no
-- longer written to the Audit Log row by row (the employee or branch itself is logged).
CREATE OR REPLACE FUNCTION link_waiting_collections() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  t record;
BEGIN
  PERFORM set_config('app.link_sync', 'on', true);
  FOR t IN SELECT * FROM link_targets() LOOP
    IF TG_TABLE_NAME = 'employees' AND t.mas_link <> '' THEN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I IS NULL AND lower(trim(%I)) = lower(trim($2))', t.table_name, t.mas_link, t.mas_link, t.mas_col) USING NEW.employee_id, NEW.full_name;
    ELSIF TG_TABLE_NAME = 'branches' THEN
      EXECUTE format('UPDATE %I SET %I = $1 WHERE %I IS NULL AND lower(trim(%I)) = lower(trim($2))', t.table_name, t.branch_link, t.branch_link, t.branch_col) USING NEW.branch_id, NEW.branch_name_code;
    END IF;
  END LOOP;
  PERFORM set_config('app.link_sync', '', true);
  RETURN NULL;
END;
$$;

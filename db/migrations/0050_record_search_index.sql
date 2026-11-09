CREATE INDEX "collections_program_idx" ON "collections" USING btree ("program_id");--> statement-breakpoint
-- Search Records (lib/record-search.ts) matches each typed word against a whole collection as text (collections::text).
-- Turning 70,000 collections into text took about 0.75 s per search, so each collection's text is kept here, written by a
-- trigger on every insert, update and delete, with a trigram index for "contains this word". It lives in its own schema,
-- not public: attach_audit_triggers() and attach_change_triggers() attach to every public table, and an audit row for
-- each collection save would double the Audit Log; the Supabase API does not expose this schema either. Not in
-- db/schema.ts. To rebuild it (for example after a column of collections is added, so old rows include it):
--   insert into search.collection_text select c.collection_id, c::text from collections c
--   on conflict (collection_id) do update set search_text = excluded.search_text;
CREATE SCHEMA IF NOT EXISTS "extensions";--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA "extensions";--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "search";--> statement-breakpoint
CREATE TABLE "search"."collection_text" ("collection_id" text PRIMARY KEY, "search_text" text NOT NULL);--> statement-breakpoint
CREATE OR REPLACE FUNCTION "search"."sync_collection_text"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND OLD.collection_id IS DISTINCT FROM NEW.collection_id) THEN
    DELETE FROM search.collection_text WHERE collection_id = OLD.collection_id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO search.collection_text (collection_id, search_text) VALUES (NEW.collection_id, NEW::text)
    ON CONFLICT (collection_id) DO UPDATE SET search_text = EXCLUDED.search_text;
  END IF;
  RETURN NULL;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sync_collection_text" AFTER INSERT OR UPDATE OR DELETE ON "collections" FOR EACH ROW EXECUTE FUNCTION "search"."sync_collection_text"();--> statement-breakpoint
INSERT INTO "search"."collection_text" ("collection_id", "search_text") SELECT c.collection_id, c::text FROM "collections" c;--> statement-breakpoint
CREATE INDEX "collection_text_trgm_idx" ON "search"."collection_text" USING gin ("search_text" "extensions"."gin_trgm_ops");

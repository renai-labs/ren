-- usage_event is only inserted: Postgres refuses an update or a delete of a row (usage spec §4.3).
CREATE FUNCTION usage_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'usage_event is append only: % refused', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_event_append_only BEFORE UPDATE OR DELETE ON usage_event
  FOR EACH ROW EXECUTE FUNCTION usage_event_append_only();

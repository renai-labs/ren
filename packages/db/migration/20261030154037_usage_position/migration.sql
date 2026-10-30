ALTER TABLE "usage_event" ADD COLUMN "position" bigserial;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_event_position_idx" ON "usage_event" ("position");--> statement-breakpoint
-- Usage saves take turns: each save holds one lock until it commits, and numbers its rows after it
-- takes the lock. So position order is commit order, and a reader that has seen a position has seen
-- every row below it. Billing keeps its place in usage_event as one position.
CREATE FUNCTION usage_event_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('usage_event_position'));
  NEW.position := nextval(pg_get_serial_sequence('usage_event', 'position'));
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_event_position BEFORE INSERT ON usage_event
  FOR EACH ROW EXECUTE FUNCTION usage_event_position();

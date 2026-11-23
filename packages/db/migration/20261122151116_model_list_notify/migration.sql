-- Providers P26: an organization's brains pull at once when its model list changed, and only then. A row that one organization's change writes notifies 'org:<id>'; Postgres folds the same payload in one transaction into one notification.
CREATE FUNCTION ren_notify_organization_brains() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  PERFORM pg_notify('ren_brains', 'org:' || r.organization_id);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER organization_model_list_ren_notify_brains AFTER INSERT OR UPDATE OF hash ON organization_model_list FOR EACH ROW EXECUTE FUNCTION ren_notify_organization_brains();

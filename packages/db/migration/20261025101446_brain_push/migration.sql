-- HR10, HR11, HR23, HR25: a write that a running brain must see at once sends NOTIFY ren_brains with the scope of the brains it reaches: 'space:<id>', 'org:<id>' or 'all'. Postgres sends it at commit and folds the same payload in one transaction into one notification.
CREATE FUNCTION ren_notify_brains() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  scope text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'settings' THEN
    IF r.space_id IS NOT NULL THEN scope := 'space:' || r.space_id;
    ELSIF r.organization_id IS NOT NULL THEN scope := 'org:' || r.organization_id;
    ELSIF r.agent_id IS NOT NULL THEN
      SELECT coalesce('org:' || organization_id, 'all') INTO scope FROM agent WHERE id = r.agent_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
    ELSE scope := 'all';
    END IF;
  ELSIF TG_TABLE_NAME = 'agent' THEN
    scope := coalesce('org:' || r.organization_id, 'all');
  ELSIF TG_TABLE_NAME = 'app_profile' THEN
    scope := 'org:' || r.organization_id;
  ELSIF TG_TABLE_NAME = 'app_profile_link' THEN
    SELECT 'org:' || organization_id INTO scope FROM app_profile WHERE id = r.profile_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'credential' THEN
    scope := coalesce('space:' || r.space_id, 'org:' || r.organization_id);
  ELSE
    scope := 'space:' || r.space_id;
  END IF;
  PERFORM pg_notify('ren_brains', scope);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER settings_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON settings FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER agent_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON agent FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER agent_membership_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON agent_membership FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER credential_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON credential FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER app_profile_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON app_profile FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER app_profile_space_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON app_profile_space FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER app_profile_link_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON app_profile_link FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER space_member_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON space_member FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER agent_session_ren_notify_brains_delete AFTER DELETE ON agent_session FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
CREATE TRIGGER agent_session_ren_notify_brains_update AFTER UPDATE OF archived_at, agent_id ON agent_session FOR EACH ROW WHEN (OLD.archived_at IS DISTINCT FROM NEW.archived_at OR OLD.agent_id IS DISTINCT FROM NEW.agent_id) EXECUTE FUNCTION ren_notify_brains();

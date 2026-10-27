CREATE TABLE "memory" (
	"organization_id" text UNIQUE,
	"space_id" text UNIQUE,
	"files" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "memory_one_owner_check" CHECK (num_nonnulls("organization_id", "space_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "memory" ADD CONSTRAINT "memory_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- memory M10: a memory write pushes to the brains of its space, or of its organization for the organization's memory.
CREATE OR REPLACE FUNCTION ren_notify_brains() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  scope text;
BEGIN
  IF TG_OP = 'DELETE' THEN r := OLD; ELSE r := NEW; END IF;
  IF TG_TABLE_NAME = 'channel_mapping' AND TG_OP = 'UPDATE' THEN
    IF OLD.space_id IS DISTINCT FROM NEW.space_id THEN
      PERFORM pg_notify('ren_brains', 'space:' || OLD.space_id);
    END IF;
  END IF;
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
  ELSIF TG_TABLE_NAME = 'app_profile' OR TG_TABLE_NAME = 'channel_install' THEN
    scope := 'org:' || r.organization_id;
  ELSIF TG_TABLE_NAME = 'app_profile_link' THEN
    SELECT 'org:' || organization_id INTO scope FROM app_profile WHERE id = r.profile_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
  ELSIF TG_TABLE_NAME = 'credential' OR TG_TABLE_NAME = 'memory' THEN
    scope := coalesce('space:' || r.space_id, 'org:' || r.organization_id);
  ELSE
    scope := 'space:' || r.space_id;
  END IF;
  PERFORM pg_notify('ren_brains', scope);
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER memory_ren_notify_brains AFTER INSERT OR UPDATE OR DELETE ON memory FOR EACH ROW EXECUTE FUNCTION ren_notify_brains();

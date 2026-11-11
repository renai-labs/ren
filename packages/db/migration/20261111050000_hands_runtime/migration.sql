CREATE TABLE "bundle" (
	"kind" text PRIMARY KEY,
	"version" text NOT NULL,
	"sha256" text NOT NULL,
	"built_at" timestamp NOT NULL
);
--> statement-breakpoint
DROP TABLE "space_environment_template";--> statement-breakpoint
ALTER TABLE "brain" RENAME COLUMN "template" TO "image";--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "image_template" jsonb;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "hand_placement" text;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "bundles" jsonb;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "unanswered_since" timestamp;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "network_hosts" jsonb;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "image_template" jsonb;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "egress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "run_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "phase" text DEFAULT 'creating' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "keep_alive_until" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "last_active_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "last_progress_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "unanswered_since" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "network_hosts" jsonb;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "bundles" jsonb;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "networking" jsonb DEFAULT '{"type":"unrestricted"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image_config" jsonb;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image_system" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_error" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_id" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_version" integer;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "continue_message_id" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "hand_placement" text DEFAULT 'colocated' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "environment_template_id" text;--> statement-breakpoint
CREATE INDEX "space_environment_template_id_idx" ON "space" ("environment_template_id");--> statement-breakpoint
ALTER TABLE "environment_template" ADD CONSTRAINT "environment_template_build_status_check" CHECK ("build_status" in ('queued', 'building', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_hand_check" CHECK (case "hand_placement" when 'colocated' then true when 'remote' then "environment_template_id" is not null when 'none' then "environment_template_id" is null else false end);--> statement-breakpoint
-- Networking rule 4: a change to a template's networking reaches the awake machines of its organization at once. Written by hand: regenerating this migration drops it, so add it again.
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
  ELSIF TG_TABLE_NAME = 'app_profile' OR TG_TABLE_NAME = 'channel_install' OR TG_TABLE_NAME = 'environment_template' THEN
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
$$;--> statement-breakpoint
CREATE TRIGGER environment_template_ren_notify_brains AFTER UPDATE OF networking ON environment_template FOR EACH ROW WHEN (OLD.networking IS DISTINCT FROM NEW.networking) EXECUTE FUNCTION ren_notify_brains();
--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "brain_provider" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "brain_template_id" text;--> statement-breakpoint
CREATE INDEX "space_brain_template_id_idx" ON "space" ("brain_template_id");--> statement-breakpoint
ALTER TABLE "space" DROP CONSTRAINT "space_hand_check", ADD CONSTRAINT "space_hand_check" CHECK (case "hand_placement" when 'remote' then "environment_template_id" is not null when 'colocated' then "environment_template_id" is null when 'none' then "environment_template_id" is null else false end);--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "hand" jsonb;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "compute_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "compute_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "session_environment" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "session_environment" ADD COLUMN "reserved_until" timestamp;--> statement-breakpoint
UPDATE "environment" AS e SET "target" = jsonb_build_object('environmentTemplateId', e."environment_template_id", 'image', e."image", 'config', COALESCE(e."image_template"->'config', t."config"), 'system', e."image_template"->'system') FROM "environment_template" AS t WHERE t."id" = e."environment_template_id";--> statement-breakpoint
UPDATE "session_environment" AS s SET "target" = e."target" FROM "environment" AS e WHERE e."id" = s."environment_id";--> statement-breakpoint
UPDATE "session_environment" AS s SET "target" = jsonb_build_object('environmentTemplateId', t."id", 'image', t."image", 'config', COALESCE(t."image_config", t."config"), 'system', t."image_system") FROM "environment_template" AS t WHERE t."id" = s."environment_template_id" AND s."target" IS NULL;--> statement-breakpoint
UPDATE "session_environment" SET "reserved_until" = now() + interval '3 days' WHERE "environment_id" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "session_environment" DROP COLUMN "idle_at";--> statement-breakpoint
ALTER TABLE "environment" ALTER COLUMN "target" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_environment" ALTER COLUMN "target" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_state" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_report" jsonb;
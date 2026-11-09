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
ALTER TABLE "environment_template" ADD COLUMN "networking" jsonb DEFAULT '{"type":"unrestricted"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image_config" jsonb;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_error" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "continue_message_id" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "brain_provider" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "hand_placement" text DEFAULT 'colocated' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "environment_template_id" text;--> statement-breakpoint
CREATE INDEX "space_environment_template_id_idx" ON "space" ("environment_template_id");--> statement-breakpoint
ALTER TABLE "environment_template" ADD CONSTRAINT "environment_template_build_status_check" CHECK ("build_status" in ('queued', 'building', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_hand_check" CHECK (case "hand_placement" when 'colocated' then true when 'remote' then "environment_template_id" is not null when 'none' then "environment_template_id" is null else false end);
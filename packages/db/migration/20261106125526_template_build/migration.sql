ALTER TABLE "environment_template" ADD COLUMN "networking" jsonb DEFAULT '{"type":"unrestricted"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_error" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "config_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD CONSTRAINT "environment_template_build_status_check" CHECK ("build_status" in ('queued', 'building', 'ready', 'failed'));
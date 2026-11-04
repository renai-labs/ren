DROP TABLE "space_environment_template";--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "networking" jsonb DEFAULT '{"type":"unrestricted"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "environment_template" ADD COLUMN "build_error" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "environment" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "environment_template_id" text;--> statement-breakpoint
CREATE INDEX "space_environment_template_id_idx" ON "space" ("environment_template_id");--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_environment_template_id_environment_template_id_fkey" FOREIGN KEY ("environment_template_id") REFERENCES "environment_template"("id");--> statement-breakpoint
ALTER TABLE "environment_template" ADD CONSTRAINT "environment_template_build_status_check" CHECK ("build_status" in ('queued', 'building', 'ready', 'failed'));--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_environment_check" CHECK ("environment" in ('default', 'template', 'none'));--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_environment_template_check" CHECK (("environment" = 'template') = ("environment_template_id" is not null));
CREATE TABLE "artifact_deployment" (
	"id" text PRIMARY KEY,
	"artifact_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"base_deployment_id" text,
	"session_id" text,
	"upload_id" text,
	"title" text,
	"entry" text,
	"config" jsonb,
	"code_archive" text,
	"url" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "artifact_name_sync" (
	"name" text PRIMARY KEY,
	"epoch" integer NOT NULL,
	"synced_epoch" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact" RENAME COLUMN "binding" TO "remote";--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "remote_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "pending_deployment_id" text;--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "published_deployment_id" text;--> statement-breakpoint
ALTER TABLE "artifact" DROP COLUMN "active_deployment_id";--> statement-breakpoint
ALTER TABLE "artifact" ALTER COLUMN "config" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_label_idx" ON "artifact" (lower("id"));--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_name_idx" ON "artifact" ("name");--> statement-breakpoint
CREATE INDEX "artifact_deployment_artifact_id_idx" ON "artifact_deployment" ("artifact_id");--> statement-breakpoint
ALTER TABLE "artifact_deployment" ADD CONSTRAINT "artifact_deployment_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact_deployment" ADD CONSTRAINT "artifact_deployment_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;--> statement-breakpoint
-- A Cloudflare artifact published before dispatch namespaces keeps a remote that the provider cannot use. Clear it: the next deploy publishes the artifact into the namespace, at its new URL.
UPDATE "artifact" SET "remote" = NULL, "remote_version" = "remote_version" + 1, "url" = NULL, "published_deployment_id" = NULL
WHERE "provider" = 'cloudflare' AND "remote" IS NOT NULL AND ("remote" ->> 'version') IS DISTINCT FROM '3';

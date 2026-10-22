CREATE TABLE "brain" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"scope" text NOT NULL,
	"key_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"provider" text,
	"binding" jsonb,
	"url" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"phase" text DEFAULT 'creating' NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"failure" text,
	"keep_alive_until" timestamp,
	"last_active_at" timestamp,
	"last_progress_at" timestamp,
	"progress" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "brain_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "brain_scope" text DEFAULT 'space' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "brain_space_id_uidx" ON "brain" ("space_id") WHERE "scope" = 'space';--> statement-breakpoint
CREATE INDEX "brain_organization_id_idx" ON "brain" ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_session_brain_id_idx" ON "agent_session" ("brain_id");--> statement-breakpoint
ALTER TABLE "brain" ADD CONSTRAINT "brain_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "brain" ADD CONSTRAINT "brain_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_brain_id_brain_id_fkey" FOREIGN KEY ("brain_id") REFERENCES "brain"("id") ON DELETE CASCADE;
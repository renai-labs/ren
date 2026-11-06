CREATE TABLE "webhook" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"agent_id" text,
	"mode" text DEFAULT 'listening' NOT NULL,
	"mode_reason" text,
	"message" text NOT NULL,
	"parser" jsonb NOT NULL,
	"token" jsonb NOT NULL,
	"signing_secret" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "webhook_mode_check" CHECK ("mode" in ('listening', 'live')),
	CONSTRAINT "webhook_mode_reason_check" CHECK ("mode_reason" in ('owner_left', 'agent_removed', 'parser_broken'))
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY,
	"webhook_id" text NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"outcome" text NOT NULL,
	"broken" boolean DEFAULT false NOT NULL,
	"reason" text,
	"verified" boolean NOT NULL,
	"event_id" text,
	"thread_key" text,
	"session_id" text,
	"method" text NOT NULL,
	"query" jsonb DEFAULT '{}' NOT NULL,
	"headers" jsonb NOT NULL,
	"body" text,
	CONSTRAINT "webhook_delivery_outcome_check" CHECK ("outcome" in ('recorded', 'throttled', 'answered', 'started', 'continued', 'ignored', 'duplicate', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "webhook_space_id_idx" ON "webhook" ("space_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_space_id_slug_uidx" ON "webhook" ("space_id","slug") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "webhook_delivery_webhook_id_received_at_idx" ON "webhook_delivery" ("webhook_id","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_delivery_webhook_id_event_id_uidx" ON "webhook_delivery" ("webhook_id","event_id") WHERE ("event_id" is not null);--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_webhook_id_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhook"("id") ON DELETE CASCADE;
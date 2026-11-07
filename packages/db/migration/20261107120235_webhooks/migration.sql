CREATE TABLE "webhook" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text,
	"message" text,
	"parser" jsonb,
	"app_id" text,
	"preset" text,
	"owner_id" text NOT NULL,
	"fallback_user_id" text,
	"agent_id" text,
	"mode" text DEFAULT 'listening' NOT NULL,
	"mode_reason" text,
	"token" jsonb NOT NULL,
	"signing_secret" jsonb,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "webhook_source_check" CHECK (("app_id" is null and "preset" is null and "name" is not null and "message" is not null and "parser" is not null) or ("app_id" is not null and "preset" is not null and "name" is null and "message" is null and "parser" is null)),
	CONSTRAINT "webhook_mode_check" CHECK ("mode" in ('listening', 'live')),
	CONSTRAINT "webhook_mode_reason_check" CHECK ("mode_reason" in ('owner_left', 'agent_removed', 'parser_broken', 'preset_removed'))
);
--> statement-breakpoint
CREATE TABLE "webhook_request" (
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
	"replays" integer DEFAULT 0 NOT NULL,
	"method" text NOT NULL,
	"query" jsonb DEFAULT '{}' NOT NULL,
	"headers" jsonb NOT NULL,
	"body" text,
	CONSTRAINT "webhook_request_outcome_check" CHECK ("outcome" in ('queued', 'started', 'continued', 'failed', 'recorded', 'throttled', 'answered', 'rejected', 'ignored', 'duplicate'))
);
--> statement-breakpoint
ALTER TABLE "channel_thread" RENAME TO "intake_thread";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "provider" TO "origin";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "install" TO "origin_id";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "thread" TO "thread_key";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "session_id" TO "current_session_id";--> statement-breakpoint
ALTER TABLE "intake_thread" RENAME COLUMN "data" TO "channel_state";--> statement-breakpoint
ALTER INDEX "channel_thread_provider_install_thread_uidx" RENAME TO "intake_thread_origin_origin_id_thread_key_uidx";--> statement-breakpoint
ALTER INDEX "channel_thread_session_id_idx" RENAME TO "intake_thread_current_session_id_idx";--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "webhooks" jsonb DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "intake_thread" SET "channel_state" = "channel_state" || jsonb_strip_nulls(jsonb_build_object(
  'url', "url",
  'placeName', "place_name",
  'lastMessage', "last_message",
  'lastMessageAt', to_char("last_message_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'lastReplyAt', to_char("last_reply_at", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
));--> statement-breakpoint
ALTER TABLE "intake_thread" DROP COLUMN "url";--> statement-breakpoint
ALTER TABLE "intake_thread" DROP COLUMN "place_name";--> statement-breakpoint
ALTER TABLE "intake_thread" DROP COLUMN "last_message";--> statement-breakpoint
ALTER TABLE "intake_thread" DROP COLUMN "last_message_at";--> statement-breakpoint
ALTER TABLE "intake_thread" DROP COLUMN "last_reply_at";--> statement-breakpoint
CREATE INDEX "webhook_space_id_idx" ON "webhook" ("space_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_space_id_slug_uidx" ON "webhook" ("space_id","slug") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_space_id_app_id_preset_uidx" ON "webhook" ("space_id","app_id","preset") WHERE "archived_at" is null and "app_id" is not null;--> statement-breakpoint
CREATE INDEX "webhook_request_webhook_id_received_at_idx" ON "webhook_request" ("webhook_id","received_at");--> statement-breakpoint
CREATE INDEX "webhook_request_session_id_idx" ON "webhook_request" ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_request_webhook_id_event_id_uidx" ON "webhook_request" ("webhook_id","event_id") WHERE "event_id" is not null and "outcome" <> 'duplicate';--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_fallback_user_id_user_id_fkey" FOREIGN KEY ("fallback_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook" ADD CONSTRAINT "webhook_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "webhook_request" ADD CONSTRAINT "webhook_request_webhook_id_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhook"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_request" ADD CONSTRAINT "webhook_request_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;
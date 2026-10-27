CREATE TABLE "schedule" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"name" text NOT NULL,
	"owner_id" text NOT NULL,
	"agent_id" text,
	"cron" text,
	"time_zone" text,
	"until_at" timestamp,
	"run_at" timestamp,
	"target_session_id" text,
	"message" text NOT NULL,
	"next_run_at" timestamp,
	"paused_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "schedule_when_check" CHECK (("cron" is null) <> ("run_at" is null)),
	CONSTRAINT "schedule_time_zone_check" CHECK (("cron" is null) = ("time_zone" is null)),
	CONSTRAINT "schedule_paused_reason_check" CHECK ("paused_reason" in ('user', 'owner_left', 'agent_removed', 'failing'))
);
--> statement-breakpoint
CREATE TABLE "schedule_run" (
	"id" text PRIMARY KEY,
	"schedule_id" text NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"started_at" timestamp,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reason" text,
	"error" text,
	"session_id" text NOT NULL,
	"message_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_run_trigger_check" CHECK ("trigger" in ('timed', 'manual')),
	CONSTRAINT "schedule_run_status_check" CHECK ("status" in ('pending', 'started', 'skipped', 'failed')),
	CONSTRAINT "schedule_run_reason_check" CHECK ("reason" in ('previous_run_busy', 'paused', 'archived', 'owner_left', 'agent_removed', 'chat_archived'))
);
--> statement-breakpoint
CREATE INDEX "schedule_due_idx" ON "schedule" ("next_run_at") WHERE "archived_at" is null and "paused_reason" is null;--> statement-breakpoint
CREATE INDEX "schedule_space_id_idx" ON "schedule" ("space_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_run_schedule_id_scheduled_at_uidx" ON "schedule_run" ("schedule_id","scheduled_at") WHERE "trigger" = 'timed';--> statement-breakpoint
CREATE INDEX "schedule_run_schedule_id_scheduled_at_idx" ON "schedule_run" ("schedule_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "schedule_run_pending_idx" ON "schedule_run" ("status") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "schedule_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "schedule_run" ADD CONSTRAINT "schedule_run_schedule_id_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "schedule"("id") ON DELETE CASCADE;
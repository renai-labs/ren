CREATE TABLE "agent_session" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"created_by" text NOT NULL,
	"parent_id" text,
	"root_id" text NOT NULL,
	"harness" text NOT NULL,
	"start_input" jsonb,
	"sync_seq" bigint,
	"sync_upload" integer DEFAULT 0 NOT NULL,
	"sync_upload_open" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "opencode_message" (
	"id" text,
	"session_id" text,
	"type" text NOT NULL,
	"seq" bigint NOT NULL,
	"data" text NOT NULL,
	CONSTRAINT "opencode_message_pkey" PRIMARY KEY("session_id","id")
);
--> statement-breakpoint
CREATE TABLE "opencode_session" (
	"session_id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"workspace_id" text,
	"slug" text NOT NULL,
	"directory" text NOT NULL,
	"path" text,
	"title" text,
	"version" text NOT NULL,
	"summary_additions" bigint,
	"summary_deletions" bigint,
	"summary_files" bigint,
	"metadata" text,
	"cost" double precision NOT NULL,
	"tokens_input" bigint NOT NULL,
	"tokens_output" bigint NOT NULL,
	"tokens_reasoning" bigint NOT NULL,
	"tokens_cache_read" bigint NOT NULL,
	"tokens_cache_write" bigint NOT NULL,
	"permission" text,
	"agent" text,
	"model" text,
	"time_created" bigint NOT NULL,
	"time_updated" bigint NOT NULL,
	"time_idle" bigint,
	"time_viewed" bigint,
	"idle_outcome" text,
	"time_archived" bigint,
	"time_suspended" bigint
);
--> statement-breakpoint
CREATE INDEX "agent_session_root_id_idx" ON "agent_session" ("root_id");--> statement-breakpoint
CREATE INDEX "opencode_message_session_id_seq_idx" ON "opencode_message" ("session_id","seq");--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_parent_id_agent_session_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_root_id_agent_session_id_fkey" FOREIGN KEY ("root_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "opencode_message" ADD CONSTRAINT "opencode_message_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "opencode_session" ADD CONSTRAINT "opencode_session_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;
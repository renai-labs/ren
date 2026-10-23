ALTER TABLE "agent_session" ADD COLUMN "harness_version" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "revert_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "files_reset_at" timestamp;--> statement-breakpoint
ALTER TABLE "opencode_message" ADD COLUMN "removed_at" timestamp;
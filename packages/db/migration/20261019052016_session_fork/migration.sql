ALTER TABLE "agent_session" ADD COLUMN "fork_session_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "fork_message_id" text;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_fork_session_id_agent_session_id_fkey" FOREIGN KEY ("fork_session_id") REFERENCES "agent_session"("id") ON DELETE SET NULL;
ALTER TABLE "agent_session" ADD COLUMN "origin" text DEFAULT 'chat' NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_session_space_id_created_at_idx" ON "agent_session" ("space_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_session_created_by_created_at_idx" ON "agent_session" ("created_by","created_at");
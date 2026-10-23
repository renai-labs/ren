CREATE TABLE "opencode_inbox" (
	"id" text,
	"session_id" text,
	"type" text NOT NULL,
	"payload" text NOT NULL,
	"delivery" text NOT NULL,
	"enqueued_seq" bigint NOT NULL,
	CONSTRAINT "opencode_inbox_pkey" PRIMARY KEY("session_id","id")
);
--> statement-breakpoint
ALTER TABLE "opencode_inbox" ADD CONSTRAINT "opencode_inbox_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;
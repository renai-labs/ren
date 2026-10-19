CREATE TABLE "session_read" (
	"session_id" text,
	"user_id" text,
	"read_at" timestamp NOT NULL,
	CONSTRAINT "session_read_pkey" PRIMARY KEY("session_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "session_read" ADD CONSTRAINT "session_read_session_id_agent_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "agent_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_read" ADD CONSTRAINT "session_read_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
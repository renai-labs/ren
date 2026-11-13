CREATE TABLE "space_join_request" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"decided_at" timestamp,
	CONSTRAINT "space_join_request_status_check" CHECK ("status" in ('pending', 'approved', 'declined', 'cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "space_join_request_space_id_user_id_pending_uidx" ON "space_join_request" ("space_id","user_id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "space_join_request_user_id_idx" ON "space_join_request" ("user_id");--> statement-breakpoint
ALTER TABLE "space_join_request" ADD CONSTRAINT "space_join_request_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_join_request" ADD CONSTRAINT "space_join_request_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_join_request" ADD CONSTRAINT "space_join_request_decided_by_user_id_fkey" FOREIGN KEY ("decided_by") REFERENCES "user"("id") ON DELETE SET NULL;
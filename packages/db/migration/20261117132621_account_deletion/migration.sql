CREATE TABLE "account_deletion" (
	"user_id" text PRIMARY KEY,
	"requested_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_deletion" ADD CONSTRAINT "account_deletion_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
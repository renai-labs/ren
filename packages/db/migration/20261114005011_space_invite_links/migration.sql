CREATE TABLE "space_invite_link" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_by" text NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "space_invite_link_space_id_uidx" ON "space_invite_link" ("space_id") WHERE ("archived_at" is null);--> statement-breakpoint
ALTER TABLE "space_invite_link" ADD CONSTRAINT "space_invite_link_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_invite_link" ADD CONSTRAINT "space_invite_link_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;
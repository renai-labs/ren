CREATE TABLE "space" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "space_name_length_check" CHECK (char_length("name") between 1 and 256)
);
--> statement-breakpoint
CREATE TABLE "space_member" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "space_pending_member" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "space_organization_id_created_at_id_idx" ON "space" ("organization_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_member_space_id_user_id_uidx" ON "space_member" ("space_id","user_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "space_member_user_id_idx" ON "space_member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_pending_member_space_id_email_uidx" ON "space_pending_member" ("space_id","email") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "space_pending_member_email_idx" ON "space_pending_member" ("email");--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_member" ADD CONSTRAINT "space_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_pending_member" ADD CONSTRAINT "space_pending_member_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;
CREATE TABLE "organization_invite_link" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_by" text NOT NULL,
	"space_ids" text[] NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organization_invite_link_organization_id_idx" ON "organization_invite_link" ("organization_id");--> statement-breakpoint
ALTER TABLE "organization_invite_link" ADD CONSTRAINT "organization_invite_link_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_invite_link" ADD CONSTRAINT "organization_invite_link_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;
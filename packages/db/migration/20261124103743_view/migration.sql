CREATE TABLE "view" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"space_id" text,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"filters" jsonb NOT NULL,
	"display" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "view_name_length_check" CHECK (char_length("name") between 1 and 64)
);
--> statement-breakpoint
CREATE INDEX "view_organization_id_space_id_idx" ON "view" ("organization_id","space_id") WHERE "archived_at" is null;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_owner_id_user_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "view" ADD CONSTRAINT "view_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;
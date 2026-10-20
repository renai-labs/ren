CREATE TABLE "agent" (
	"id" text PRIMARY KEY,
	"organization_id" text,
	"owner_space_id" text,
	"name" text NOT NULL,
	"description" text,
	"is_subagent" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "agent_global_check" CHECK (("organization_id" is null) = ("owner_space_id" is null)),
	CONSTRAINT "agent_name_length_check" CHECK (char_length("name") between 1 and 64)
);
--> statement-breakpoint
CREATE TABLE "agent_membership" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"owner_id" text PRIMARY KEY GENERATED ALWAYS AS (coalesce("settings"."agent_id", "settings"."space_id", "settings"."organization_id", 'ren')) STORED,
	"organization_id" text,
	"space_id" text,
	"agent_id" text,
	"settings" jsonb NOT NULL,
	"hash" text GENERATED ALWAYS AS (md5("settings"."settings"::text)) STORED NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "settings_one_owner_check" CHECK (num_nonnulls("organization_id", "space_id", "agent_id") <= 1)
);
--> statement-breakpoint
ALTER TABLE "agent_session" ADD COLUMN "agent_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_organization_id_name_uidx" ON "agent" ("organization_id","name") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "agent_global_name_uidx" ON "agent" ("name") WHERE "organization_id" is null and "archived_at" is null;--> statement-breakpoint
CREATE INDEX "agent_owner_space_id_idx" ON "agent" ("owner_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_membership_space_id_agent_id_uidx" ON "agent_membership" ("space_id","agent_id");--> statement-breakpoint
CREATE INDEX "agent_membership_agent_id_idx" ON "agent_membership" ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_session_agent_id_idx" ON "agent_session" ("agent_id");--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent" ADD CONSTRAINT "agent_owner_space_id_space_id_fkey" FOREIGN KEY ("owner_space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_membership" ADD CONSTRAINT "agent_membership_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_membership" ADD CONSTRAINT "agent_membership_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent_session" ADD CONSTRAINT "agent_session_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE CASCADE;
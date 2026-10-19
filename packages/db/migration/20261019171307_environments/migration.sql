CREATE TABLE "environment" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"provider" text NOT NULL,
	"config" jsonb NOT NULL,
	"sessions_per_hand" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "environment_name_length_check" CHECK (char_length("name") between 1 and 256),
	CONSTRAINT "environment_sessions_per_hand_check" CHECK ("sessions_per_hand" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "hand" (
	"id" text PRIMARY KEY,
	"environment_id" text NOT NULL,
	"binding" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_environment" (
	"session_id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"hand_id" text,
	"generation" integer DEFAULT 1 NOT NULL,
	"idle_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "session_environment_generation_check" CHECK ("generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "space_environment" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "environment_organization_id_created_at_id_idx" ON "environment" ("organization_id","created_at","id");--> statement-breakpoint
CREATE INDEX "hand_environment_id_created_at_idx" ON "hand" ("environment_id","created_at");--> statement-breakpoint
CREATE INDEX "session_environment_hand_id_idx" ON "session_environment" ("hand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_environment_space_id_environment_id_uidx" ON "space_environment" ("space_id","environment_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "space_environment_environment_id_idx" ON "space_environment" ("environment_id");--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "hand" ADD CONSTRAINT "hand_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_environment" ADD CONSTRAINT "session_environment_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_environment" ADD CONSTRAINT "session_environment_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session_environment" ADD CONSTRAINT "session_environment_hand_id_hand_id_fkey" FOREIGN KEY ("hand_id") REFERENCES "hand"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "space_environment" ADD CONSTRAINT "space_environment_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space_environment" ADD CONSTRAINT "space_environment_environment_id_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "environment"("id") ON DELETE CASCADE;
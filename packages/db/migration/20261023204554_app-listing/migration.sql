CREATE TABLE "app_listing" (
	"app_id" text PRIMARY KEY,
	"body" text,
	"categories" jsonb DEFAULT '{}' NOT NULL,
	"example_prompts" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "app_listing" ADD CONSTRAINT "app_listing_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");
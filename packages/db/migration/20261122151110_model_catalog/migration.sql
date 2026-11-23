CREATE TABLE "model_catalog" (
	"source" text PRIMARY KEY,
	"etag" text,
	"revision" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization_model_list" (
	"organization_id" text PRIMARY KEY,
	"hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_model_list" ADD CONSTRAINT "organization_model_list_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
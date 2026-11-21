CREATE TABLE "artifact" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"space_id" text NOT NULL,
	"title" text NOT NULL,
	"provider" text NOT NULL,
	"code_archive" text,
	"config" jsonb NOT NULL,
	"binding" jsonb,
	"url" text,
	"active_deployment_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "artifact_space_id_idx" ON "artifact" ("space_id");--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "artifact" ADD CONSTRAINT "artifact_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;
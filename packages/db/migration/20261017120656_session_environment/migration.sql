CREATE TABLE "session_environment" (
	"session_id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"environment_id" text NOT NULL,
	"sandbox_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "session_environment_environment_id_sandbox_id_idx" ON "session_environment" ("environment_id","sandbox_id");--> statement-breakpoint
ALTER TABLE "session_environment" ADD CONSTRAINT "session_environment_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
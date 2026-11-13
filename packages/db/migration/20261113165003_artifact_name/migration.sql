CREATE TABLE "artifact_name_sync" (
	"name" text PRIMARY KEY,
	"epoch" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact" ADD COLUMN "name" text;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_name_idx" ON "artifact" ("name");
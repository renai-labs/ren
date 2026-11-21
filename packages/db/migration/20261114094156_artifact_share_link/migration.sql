CREATE TABLE "artifact_share_link" (
	"token" text PRIMARY KEY,
	"artifact_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "artifact_share_link" ADD CONSTRAINT "artifact_share_link_artifact_id_artifact_id_fkey" FOREIGN KEY ("artifact_id") REFERENCES "artifact"("id") ON DELETE CASCADE;
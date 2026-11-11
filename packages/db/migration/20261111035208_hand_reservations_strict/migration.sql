ALTER TABLE "session_environment" DROP COLUMN "idle_at";--> statement-breakpoint
ALTER TABLE "environment" ALTER COLUMN "target" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "session_environment" ALTER COLUMN "target" SET NOT NULL;
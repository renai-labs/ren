ALTER TABLE "environment" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "session_environment" ADD COLUMN "target" jsonb;--> statement-breakpoint
ALTER TABLE "session_environment" ADD COLUMN "reserved_until" timestamp;
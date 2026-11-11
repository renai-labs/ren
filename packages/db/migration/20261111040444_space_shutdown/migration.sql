ALTER TABLE "brain" ADD COLUMN "stopped_at" timestamp;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_state" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "shutdown_report" jsonb;
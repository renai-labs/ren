ALTER TABLE "environment" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "template_config" jsonb;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "egress" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "generation" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "run_epoch" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "phase" text DEFAULT 'creating' NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "failure" text;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "keep_alive_until" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "last_active_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "last_progress_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "environment" ADD COLUMN "unanswered_since" timestamp;
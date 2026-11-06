ALTER TABLE "brain" ADD COLUMN "retry_at" timestamp;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "retries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "unanswered_since" timestamp;
ALTER TABLE "brain" ADD COLUMN "hand" jsonb;--> statement-breakpoint
ALTER TABLE "brain" ADD COLUMN "compute_revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "compute_revision" integer DEFAULT 0 NOT NULL;
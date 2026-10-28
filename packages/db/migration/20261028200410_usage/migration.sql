CREATE TABLE "usage_event" (
	"source" text,
	"id" text,
	"type" text NOT NULL,
	"time" timestamp NOT NULL,
	"workload" text NOT NULL,
	"organization" text NOT NULL,
	"space" text,
	"brain" text,
	"root_session" text,
	"session" text,
	"turn" text,
	"member" text,
	"agent" text,
	"agent_name" text,
	"kind" text,
	"requested_model" text NOT NULL,
	"variant" text,
	"payer" text NOT NULL,
	"provider" text NOT NULL,
	"served_model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_1h_tokens" integer DEFAULT 0 NOT NULL,
	"cost_micro_usd" bigint,
	"latency_ms" integer,
	"time_to_first_token_ms" integer,
	"stop_reason" text,
	"error" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_pkey" PRIMARY KEY("source","id")
);
--> statement-breakpoint
ALTER TABLE "registered_key" ADD COLUMN "secret_hash" text;--> statement-breakpoint
ALTER TABLE "registered_key" ADD COLUMN "producer" text;--> statement-breakpoint
ALTER TABLE "registered_key" ALTER COLUMN "public_key" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_key_secret_hash_uidx" ON "registered_key" ("secret_hash");--> statement-breakpoint
CREATE INDEX "usage_event_organization_time_idx" ON "usage_event" ("organization","time");--> statement-breakpoint
CREATE INDEX "usage_event_session_idx" ON "usage_event" ("session");--> statement-breakpoint
ALTER TABLE "registered_key" ADD CONSTRAINT "registered_key_secret_check" CHECK (("public_key" is null) = ("secret_hash" is not null));
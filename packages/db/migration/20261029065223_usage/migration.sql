CREATE TABLE "usage_attribution" (
	"source" text,
	"id" text,
	"space" text,
	"root_session" text,
	"session" text,
	"turn" text,
	"member" text,
	"agent" text,
	"kind" text,
	"problems" text[] NOT NULL,
	"reconciled_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usage_attribution_pkey" PRIMARY KEY("source","id")
);
--> statement-breakpoint
CREATE TABLE "usage_event" (
	"source" text,
	"id" text,
	"type" text NOT NULL,
	"time" timestamp NOT NULL,
	"workload" text NOT NULL,
	"organization" text NOT NULL,
	"brain" text,
	"space" text,
	"root_session" text,
	"session" text,
	"turn" text,
	"member" text,
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
CREATE TABLE "usage_pending" (
	"source" text,
	"id" text,
	CONSTRAINT "usage_pending_pkey" PRIMARY KEY("source","id")
);
--> statement-breakpoint
ALTER TABLE "registered_key" ADD COLUMN "secret_hash" text;--> statement-breakpoint
ALTER TABLE "registered_key" ADD COLUMN "producer" text;--> statement-breakpoint
ALTER TABLE "registered_key" ALTER COLUMN "public_key" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_key_secret_hash_uidx" ON "registered_key" ("secret_hash");--> statement-breakpoint
CREATE INDEX "usage_attribution_session_idx" ON "usage_attribution" ("session");--> statement-breakpoint
CREATE INDEX "usage_event_organization_time_idx" ON "usage_event" ("organization","time");--> statement-breakpoint
ALTER TABLE "registered_key" ADD CONSTRAINT "registered_key_secret_check" CHECK (("public_key" is null) = ("secret_hash" is not null));
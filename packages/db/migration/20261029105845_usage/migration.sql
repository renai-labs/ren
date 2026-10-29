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
	"agent" text,
	"payer" text NOT NULL,
	"provider" text NOT NULL,
	"cost_micro_usd" bigint,
	"error" jsonb,
	"data" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "usage_event_pkey" PRIMARY KEY("source","id")
);
--> statement-breakpoint
CREATE INDEX "usage_event_organization_time_idx" ON "usage_event" ("organization","time");--> statement-breakpoint
CREATE FUNCTION usage_event_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'usage_event is append only: % refused', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_event_append_only BEFORE UPDATE OR DELETE ON usage_event
  FOR EACH ROW EXECUTE FUNCTION usage_event_append_only();

ALTER TABLE "space" ADD COLUMN "factory" jsonb DEFAULT '{"maxHandoffs":20,"agents":[]}' NOT NULL;--> statement-breakpoint
UPDATE "space" SET "factory" = jsonb_build_object(
  'maxHandoffs', 20,
  'agents', (
    SELECT coalesce(jsonb_agg(jsonb_build_object('agentId', ordered.id) ORDER BY ordered.position), '[]'::jsonb)
    FROM jsonb_array_elements_text("agent_order") WITH ORDINALITY AS ordered(id, position)
  )
) WHERE jsonb_array_length("agent_order") > 0;--> statement-breakpoint
ALTER TABLE "space" DROP COLUMN "agent_order";
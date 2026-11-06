DROP TABLE "space_environment_template";--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "hand_placement" text DEFAULT 'colocated' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "environment_template_id" text;--> statement-breakpoint
CREATE INDEX "space_environment_template_id_idx" ON "space" ("environment_template_id");--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_hand_check" CHECK (case "hand_placement" when 'colocated' then true when 'remote' then "environment_template_id" is not null when 'none' then "environment_template_id" is null else false end);
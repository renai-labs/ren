CREATE TABLE "channel_install" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"workspace" text NOT NULL,
	"name" text NOT NULL,
	"bot_user" text,
	"credential_id" text,
	"installed_by" text,
	"default_space_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_install_state" (
	"state" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"initiator_user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "channel_mapping" (
	"id" text PRIMARY KEY,
	"install_id" text NOT NULL,
	"place" text NOT NULL,
	"place_name" text NOT NULL,
	"space_id" text NOT NULL,
	"agent_id" text,
	"fallback" boolean DEFAULT true NOT NULL,
	"fallback_user_id" text,
	"triggers" jsonb DEFAULT '[]' NOT NULL,
	"created_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_thread" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"install" text NOT NULL,
	"thread" text NOT NULL,
	"session_id" text NOT NULL,
	"url" text,
	"place_name" text,
	"last_message" text,
	"last_message_at" timestamp,
	"last_reply_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "channel_install_provider_workspace_uidx" ON "channel_install" ("provider","workspace");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_install_organization_id_provider_uidx" ON "channel_install" ("organization_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_mapping_install_id_place_uidx" ON "channel_mapping" ("install_id","place");--> statement-breakpoint
CREATE INDEX "channel_mapping_space_id_idx" ON "channel_mapping" ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_thread_provider_install_thread_uidx" ON "channel_thread" ("provider","install","thread");--> statement-breakpoint
CREATE INDEX "channel_thread_session_id_idx" ON "channel_thread" ("session_id");--> statement-breakpoint
ALTER TABLE "channel_install" ADD CONSTRAINT "channel_install_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_install" ADD CONSTRAINT "channel_install_credential_id_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "credential"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_install" ADD CONSTRAINT "channel_install_installed_by_user_id_fkey" FOREIGN KEY ("installed_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_install" ADD CONSTRAINT "channel_install_default_space_id_space_id_fkey" FOREIGN KEY ("default_space_id") REFERENCES "space"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_install_state" ADD CONSTRAINT "channel_install_state_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_install_state" ADD CONSTRAINT "channel_install_state_initiator_user_id_user_id_fkey" FOREIGN KEY ("initiator_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_mapping" ADD CONSTRAINT "channel_mapping_install_id_channel_install_id_fkey" FOREIGN KEY ("install_id") REFERENCES "channel_install"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_mapping" ADD CONSTRAINT "channel_mapping_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "channel_mapping" ADD CONSTRAINT "channel_mapping_agent_id_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_mapping" ADD CONSTRAINT "channel_mapping_fallback_user_id_user_id_fkey" FOREIGN KEY ("fallback_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_mapping" ADD CONSTRAINT "channel_mapping_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "channel_thread" ADD CONSTRAINT "channel_thread_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
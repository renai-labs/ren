CREATE TABLE "oauth_app" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"client_id" text NOT NULL,
	"client_secret" jsonb,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"discovery" text DEFAULT 'live' NOT NULL,
	"authorization_endpoint" text,
	"token_endpoint" text,
	"token_endpoint_auth" text NOT NULL,
	"resource" text,
	"authorize_params" jsonb DEFAULT '{}' NOT NULL,
	"pkce" boolean DEFAULT true NOT NULL,
	"configured_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "oauth_session" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"user_id" text,
	"space_id" text,
	"label" text NOT NULL,
	"name" text,
	"credential_id" text NOT NULL,
	"app_id" text NOT NULL,
	"release_id" text NOT NULL,
	"mcp" text NOT NULL,
	"connection" text,
	"initiator_user_id" text NOT NULL,
	"oauth_app_id" text,
	"state" text NOT NULL,
	"code_verifier" text,
	"scope" text,
	"resource" text,
	"issuer" text,
	"client_info" jsonb,
	"discovery_state" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	CONSTRAINT "oauth_session_owner_check" CHECK (("owner" = 'org' and "user_id" is null and "space_id" is null)
       or ("owner" = 'space' and "user_id" is null and "space_id" is not null)
       or ("owner" = 'person' and "user_id" is not null and "space_id" is null))
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "oauth_app_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "mcp" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "connection" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "account_subject_hash" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "unauthorized_refresh_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "wanted_scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE INDEX "credential_app_id_mcp_idx" ON "credential" ("app_id","mcp");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_app_name_uidx" ON "oauth_app" ("organization_id","name") WHERE "provider" is null and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_app_provider_uidx" ON "oauth_app" ("organization_id","provider") WHERE "provider" is not null and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_session_state_uidx" ON "oauth_session" ("state");--> statement-breakpoint
CREATE INDEX "oauth_session_expires_at_idx" ON "oauth_session" ("expires_at");--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_oauth_app_id_oauth_app_id_fkey" FOREIGN KEY ("oauth_app_id") REFERENCES "oauth_app"("id");--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "oauth_app" ADD CONSTRAINT "oauth_app_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_app" ADD CONSTRAINT "oauth_app_configured_by_user_id_user_id_fkey" FOREIGN KEY ("configured_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_release_id_app_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "app_release"("id");--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_initiator_user_id_user_id_fkey" FOREIGN KEY ("initiator_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_oauth_app_id_oauth_app_id_fkey" FOREIGN KEY ("oauth_app_id") REFERENCES "oauth_app"("id");
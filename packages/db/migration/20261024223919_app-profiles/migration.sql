CREATE TABLE "app_listing" (
	"app_id" text PRIMARY KEY,
	"body" text,
	"categories" jsonb DEFAULT '{}' NOT NULL,
	"example_prompts" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "app" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"organization_id" text,
	"owner_space_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text,
	"required_credentials" jsonb NOT NULL,
	"environment" jsonb,
	"mcps" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "app_ownership_check" CHECK (("organization_id" is null) = ("owner_space_id" is null))
);
--> statement-breakpoint
CREATE TABLE "app_dependency" (
	"app_id" text,
	"dependency_app_id" text,
	CONSTRAINT "app_dependency_pkey" PRIMARY KEY("app_id","dependency_app_id")
);
--> statement-breakpoint
CREATE TABLE "app_profile" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"app_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"user_id" text,
	"all_spaces" boolean DEFAULT false NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_profile_kind_check" CHECK (("kind" = 'private') = ("user_id" is not null)),
	CONSTRAINT "app_profile_all_spaces_check" CHECK (not ("kind" = 'private' and "all_spaces"))
);
--> statement-breakpoint
CREATE TABLE "app_profile_link" (
	"profile_id" text,
	"dependency_app_id" text,
	"dependency_profile_id" text NOT NULL,
	CONSTRAINT "app_profile_link_pkey" PRIMARY KEY("profile_id","dependency_app_id")
);
--> statement-breakpoint
CREATE TABLE "app_profile_space" (
	"profile_id" text,
	"space_id" text,
	CONSTRAINT "app_profile_space_pkey" PRIMARY KEY("profile_id","space_id")
);
--> statement-breakpoint
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
	"credential_id" text NOT NULL,
	"profile_id" text,
	"label" text NOT NULL,
	"name" text,
	"hosts" text[] NOT NULL,
	"made_for" text NOT NULL,
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
	"same_account_as" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "profile_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "provider_account_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "oauth_app_id" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "made_for" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "account_subject_hash" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "unauthorized_refresh_at" timestamp;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "wanted_scopes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "app_slug_uidx" ON "app" ("slug");--> statement-breakpoint
CREATE INDEX "app_owner_space_id_idx" ON "app" ("owner_space_id");--> statement-breakpoint
CREATE INDEX "app_dependency_dependency_app_id_idx" ON "app_dependency" ("dependency_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_profile_slug_uidx" ON "app_profile" ("organization_id","app_id","slug");--> statement-breakpoint
CREATE INDEX "app_profile_app_id_idx" ON "app_profile" ("app_id");--> statement-breakpoint
CREATE INDEX "app_profile_user_id_idx" ON "app_profile" ("user_id");--> statement-breakpoint
CREATE INDEX "app_profile_link_dependency_profile_id_idx" ON "app_profile_link" ("dependency_profile_id");--> statement-breakpoint
CREATE INDEX "app_profile_space_space_id_idx" ON "app_profile_space" ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_profile_label_uidx" ON "credential" ("profile_id","label") WHERE "owner" = 'profile';--> statement-breakpoint
CREATE INDEX "credential_profile_id_idx" ON "credential" ("profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_app_name_uidx" ON "oauth_app" ("organization_id","name") WHERE "provider" is null and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_app_provider_uidx" ON "oauth_app" ("organization_id","provider") WHERE "provider" is not null and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_session_state_uidx" ON "oauth_session" ("state");--> statement-breakpoint
CREATE INDEX "oauth_session_expires_at_idx" ON "oauth_session" ("expires_at");--> statement-breakpoint
ALTER TABLE "app_listing" ADD CONSTRAINT "app_listing_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_owner_space_id_space_id_fkey" FOREIGN KEY ("owner_space_id") REFERENCES "space"("id");--> statement-breakpoint
ALTER TABLE "app_dependency" ADD CONSTRAINT "app_dependency_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app_dependency" ADD CONSTRAINT "app_dependency_dependency_app_id_app_id_fkey" FOREIGN KEY ("dependency_app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app_profile" ADD CONSTRAINT "app_profile_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_profile" ADD CONSTRAINT "app_profile_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app_profile" ADD CONSTRAINT "app_profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_profile" ADD CONSTRAINT "app_profile_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "app_profile_link" ADD CONSTRAINT "app_profile_link_profile_id_app_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "app_profile"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_profile_link" ADD CONSTRAINT "app_profile_link_dependency_app_id_app_id_fkey" FOREIGN KEY ("dependency_app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app_profile_link" ADD CONSTRAINT "app_profile_link_dependency_profile_id_app_profile_id_fkey" FOREIGN KEY ("dependency_profile_id") REFERENCES "app_profile"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_profile_space" ADD CONSTRAINT "app_profile_space_profile_id_app_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "app_profile"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "app_profile_space" ADD CONSTRAINT "app_profile_space_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_profile_id_app_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "app_profile"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_oauth_app_id_oauth_app_id_fkey" FOREIGN KEY ("oauth_app_id") REFERENCES "oauth_app"("id");--> statement-breakpoint
ALTER TABLE "oauth_app" ADD CONSTRAINT "oauth_app_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_app" ADD CONSTRAINT "oauth_app_configured_by_user_id_user_id_fkey" FOREIGN KEY ("configured_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_profile_id_app_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "app_profile"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_initiator_user_id_user_id_fkey" FOREIGN KEY ("initiator_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauth_session" ADD CONSTRAINT "oauth_session_oauth_app_id_oauth_app_id_fkey" FOREIGN KEY ("oauth_app_id") REFERENCES "oauth_app"("id");--> statement-breakpoint
ALTER TABLE "credential" DROP CONSTRAINT "credential_owner_check", ADD CONSTRAINT "credential_owner_check" CHECK (("owner" = 'org' and "user_id" is null and "space_id" is null and "workload_kind" is null and "workload_id" is null and "profile_id" is null)
       or ("owner" = 'space' and "user_id" is null and "space_id" is not null and "workload_kind" is null and "workload_id" is null and "profile_id" is null)
       or ("owner" = 'person' and "user_id" is not null and "space_id" is null and "workload_kind" is null and "workload_id" is null and "profile_id" is null)
       or ("owner" = 'workload' and "user_id" is null and "space_id" is null and "workload_kind" is not null and "workload_id" is not null and "profile_id" is null)
       or ("owner" = 'profile' and "user_id" is null and "space_id" is null and "workload_kind" is null and "workload_id" is null and "profile_id" is not null));
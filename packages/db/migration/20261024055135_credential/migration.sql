CREATE TABLE "credential" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"owner" text NOT NULL,
	"user_id" text,
	"space_id" text,
	"workload_kind" text,
	"workload_id" text,
	"label" text NOT NULL,
	"name" text,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"key_preview" text,
	"field_names" text[] DEFAULT '{}'::text[] NOT NULL,
	"hosts" text[] NOT NULL,
	"inject" jsonb NOT NULL,
	"delivery" text DEFAULT 'egress' NOT NULL,
	"account_user_id" text,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"status" text DEFAULT 'ok' NOT NULL,
	"expires_at" timestamp,
	"refresh_lease_at" timestamp,
	"refresh_failures" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_owner_check" CHECK (("owner" = 'org' and "user_id" is null and "space_id" is null and "workload_kind" is null and "workload_id" is null)
       or ("owner" = 'space' and "user_id" is null and "space_id" is not null and "workload_kind" is null and "workload_id" is null)
       or ("owner" = 'person' and "user_id" is not null and "space_id" is null and "workload_kind" is null and "workload_id" is null)
       or ("owner" = 'workload' and "user_id" is null and "space_id" is null and "workload_kind" is not null and "workload_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "credential_caller" (
	"workload_kind" text,
	"workload_id" text,
	"generation" integer,
	"organization_id" text NOT NULL,
	"proof_kind" text NOT NULL,
	"username" text,
	"password_hash" text,
	"address" text,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "credential_caller_pkey" PRIMARY KEY("workload_kind","workload_id","generation"),
	CONSTRAINT "credential_caller_generation_check" CHECK ("generation" >= 1)
);
--> statement-breakpoint
CREATE TABLE "registered_key" (
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"public_key" text NOT NULL,
	"organization_ids" text[],
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "credential_org_label_uidx" ON "credential" ("organization_id","label") WHERE "owner" = 'org';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_space_label_uidx" ON "credential" ("space_id","label") WHERE "owner" = 'space';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_person_label_uidx" ON "credential" ("organization_id","user_id","label") WHERE "owner" = 'person';--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workload_label_uidx" ON "credential" ("workload_kind","workload_id","label") WHERE "owner" = 'workload';--> statement-breakpoint
CREATE INDEX "credential_expires_at_idx" ON "credential" ("expires_at") WHERE "expires_at" is not null;--> statement-breakpoint
CREATE INDEX "credential_account_user_id_idx" ON "credential" ("account_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_caller_username_uidx" ON "credential_caller" ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_caller_address_uidx" ON "credential_caller" ("address") WHERE "revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "registered_key_public_key_uidx" ON "registered_key" ("public_key");--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_account_user_id_user_id_fkey" FOREIGN KEY ("account_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "credential_caller" ADD CONSTRAINT "credential_caller_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
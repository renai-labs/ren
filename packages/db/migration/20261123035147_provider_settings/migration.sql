CREATE TABLE "organization_provider" (
	"organization_id" text,
	"provider_id" text,
	"enabled" boolean NOT NULL,
	"method" text NOT NULL,
	"new_models" boolean,
	"key_last4" text,
	"key_tested_at" timestamp,
	"key_saved_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_provider_pkey" PRIMARY KEY("organization_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "organization_ren_model" (
	"organization_id" text,
	"model_id" text,
	"enabled" boolean NOT NULL,
	CONSTRAINT "organization_ren_model_pkey" PRIMARY KEY("organization_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "organization_seat_models" (
	"organization_id" text,
	"connection_id" text,
	"vendor" text NOT NULL,
	"models" text[] NOT NULL,
	"plan" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_seat_models_pkey" PRIMARY KEY("organization_id","connection_id")
);
--> statement-breakpoint
ALTER TABLE "organization_provider" ADD CONSTRAINT "organization_provider_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_provider" ADD CONSTRAINT "organization_provider_key_saved_by_member_id_fkey" FOREIGN KEY ("key_saved_by") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization_ren_model" ADD CONSTRAINT "organization_ren_model_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_seat_models" ADD CONSTRAINT "organization_seat_models_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;
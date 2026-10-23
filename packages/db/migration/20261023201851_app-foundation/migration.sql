CREATE TABLE "app" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL,
	"organization_id" text,
	"owner_space_id" text,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"icon" text,
	"latest_release_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp,
	CONSTRAINT "app_ownership_check" CHECK (("organization_id" is null) = ("owner_space_id" is null))
);
--> statement-breakpoint
CREATE TABLE "app_release" (
	"id" text PRIMARY KEY,
	"app_id" text NOT NULL,
	"version" text NOT NULL,
	"required_credentials" jsonb NOT NULL,
	"environment" jsonb,
	"mcps" jsonb NOT NULL,
	"skills" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "app_release_app_id_id_unique" UNIQUE("app_id","id"),
	CONSTRAINT "app_release_app_id_version_unique" UNIQUE("app_id","version")
);
--> statement-breakpoint
CREATE TABLE "app_release_dependency" (
	"app_release_id" text,
	"dependency_app_id" text,
	CONSTRAINT "app_release_dependency_pkey" PRIMARY KEY("app_release_id","dependency_app_id")
);
--> statement-breakpoint
CREATE TABLE "space_app" (
	"id" text PRIMARY KEY,
	"space_id" text NOT NULL,
	"app_id" text NOT NULL,
	"pinned_release_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_slug_uidx" ON "app" ("slug");--> statement-breakpoint
CREATE INDEX "app_owner_space_id_idx" ON "app" ("owner_space_id");--> statement-breakpoint
CREATE INDEX "app_release_dependency_app_idx" ON "app_release_dependency" ("dependency_app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_app_space_id_app_id_uidx" ON "space_app" ("space_id","app_id") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE INDEX "space_app_app_id_idx" ON "space_app" ("app_id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_owner_space_id_space_id_fkey" FOREIGN KEY ("owner_space_id") REFERENCES "space"("id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_latest_release_fk" FOREIGN KEY ("id","latest_release_id") REFERENCES "app_release"("app_id","id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "app_release" ADD CONSTRAINT "app_release_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "app_release_dependency" ADD CONSTRAINT "app_release_dependency_app_release_id_app_release_id_fkey" FOREIGN KEY ("app_release_id") REFERENCES "app_release"("id");--> statement-breakpoint
ALTER TABLE "app_release_dependency" ADD CONSTRAINT "app_release_dependency_dependency_app_id_app_id_fkey" FOREIGN KEY ("dependency_app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "space_app" ADD CONSTRAINT "space_app_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id");--> statement-breakpoint
ALTER TABLE "space_app" ADD CONSTRAINT "space_app_app_id_app_id_fkey" FOREIGN KEY ("app_id") REFERENCES "app"("id");--> statement-breakpoint
ALTER TABLE "space_app" ADD CONSTRAINT "space_app_pin_fk" FOREIGN KEY ("app_id","pinned_release_id") REFERENCES "app_release"("app_id","id");
ALTER TABLE "environment" ADD COLUMN "space_id" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "kind" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "owner_user_id" text;--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "space_id" text;--> statement-breakpoint
DROP INDEX "label_organization_id_name_uidx";--> statement-breakpoint
CREATE UNIQUE INDEX "label_organization_id_name_uidx" ON "label" ("organization_id",lower("name")) WHERE "space_id" is null and "archived_at" is null;--> statement-breakpoint
CREATE INDEX "environment_space_id_idx" ON "environment" ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "space_organization_id_owner_user_id_uidx" ON "space" ("organization_id","owner_user_id") WHERE "kind" = 'private' and "archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "label_space_id_name_uidx" ON "label" ("space_id",lower("name")) WHERE "space_id" is not null and "archived_at" is null;--> statement-breakpoint
ALTER TABLE "environment" ADD CONSTRAINT "environment_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_owner_user_id_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_space_id_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "space"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_kind_check" CHECK ("kind" in ('shared', 'private'));--> statement-breakpoint
ALTER TABLE "space" ADD CONSTRAINT "space_owner_check" CHECK (("kind" = 'private') = ("owner_user_id" is not null));--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_space_check" CHECK ("space_id" is null or "organization_id" is not null);
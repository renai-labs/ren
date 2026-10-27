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
ALTER TABLE "label" ADD CONSTRAINT "label_space_check" CHECK ("space_id" is null or "organization_id" is not null);--> statement-breakpoint
-- private-spaces rules 18, 19: an untouched Personal Space becomes its owner's private space.
UPDATE "space" SET "kind" = 'private', "owner_user_id" = "found"."user_id"
FROM (
  SELECT DISTINCT ON ("space"."organization_id", "member"."user_id") "space"."id", "member"."user_id"
  FROM "space"
  INNER JOIN "space_member" AS "member" ON "member"."space_id" = "space"."id" AND "member"."archived_at" IS NULL
  WHERE "space"."archived_at" IS NULL
    AND ("space"."name" = 'Personal Space' OR "space"."name" LIKE '%''s Personal Space')
    AND NOT EXISTS (SELECT 1 FROM "space_member" AS "other" WHERE "other"."space_id" = "space"."id" AND "other"."user_id" <> "member"."user_id")
    AND NOT EXISTS (SELECT 1 FROM "space_pending_member" AS "pending" WHERE "pending"."space_id" = "space"."id" AND "pending"."archived_at" IS NULL)
  ORDER BY "space"."organization_id", "member"."user_id", "space"."created_at", "space"."id"
) AS "found"
WHERE "space"."id" = "found"."id";

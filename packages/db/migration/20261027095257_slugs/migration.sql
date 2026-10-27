ALTER TABLE "schedule" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "space" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "space" SET "slug" = coalesce(nullif(rtrim(left(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 64), '-'), ''), 'space');--> statement-breakpoint
UPDATE "schedule" SET "slug" = coalesce(nullif(rtrim(left(trim(BOTH '-' FROM regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')), 64), '-'), ''), 'schedule');--> statement-breakpoint
DO $$
DECLARE
  target record;
  candidate text;
  n integer;
BEGIN
  FOR target IN SELECT "id", "organization_id", "slug", "created_at" FROM "space" WHERE "archived_at" IS NULL ORDER BY "created_at", "id" LOOP
    candidate := target."slug";
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "space" AS "other"
      WHERE "other"."organization_id" = target."organization_id"
        AND "other"."archived_at" IS NULL
        AND ("other"."created_at", "other"."id") < (target."created_at", target."id")
        AND "other"."slug" = candidate
    ) LOOP
      n := n + 1;
      candidate := rtrim(left(target."slug", 64 - length('-' || n)), '-') || '-' || n;
    END LOOP;
    UPDATE "space" SET "slug" = candidate WHERE "id" = target."id";
  END LOOP;
  FOR target IN SELECT "id", "space_id", "slug", "created_at" FROM "schedule" WHERE "archived_at" IS NULL ORDER BY "created_at", "id" LOOP
    candidate := target."slug";
    n := 1;
    WHILE EXISTS (
      SELECT 1 FROM "schedule" AS "other"
      WHERE "other"."space_id" = target."space_id"
        AND "other"."archived_at" IS NULL
        AND ("other"."created_at", "other"."id") < (target."created_at", target."id")
        AND "other"."slug" = candidate
    ) LOOP
      n := n + 1;
      candidate := rtrim(left(target."slug", 64 - length('-' || n)), '-') || '-' || n;
    END LOOP;
    UPDATE "schedule" SET "slug" = candidate WHERE "id" = target."id";
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "schedule" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "space" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_space_id_slug_uidx" ON "schedule" ("space_id","slug") WHERE ("archived_at" is null);--> statement-breakpoint
CREATE UNIQUE INDEX "space_organization_id_slug_uidx" ON "space" ("organization_id","slug") WHERE ("archived_at" is null);

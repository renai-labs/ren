-- private-spaces rules 18 and 19: a space that provisioning made as a person's Personal Space, and that never had another member or a pending invite, becomes that person's private space. When a person has two such spaces in one org, the oldest becomes private.
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

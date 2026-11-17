import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { eq } from "drizzle-orm"
import { ConfigProvider, Effect, Layer } from "effect"
import { AccountDeletion } from "../src/account-deletion.js"
import { Mailer } from "../src/mailer.js"
import { testEffect } from "./lib/effect.js"
import { Postmark } from "./lib/postmark.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(
  AccountDeletion.layer.pipe(
    Layer.provideMerge(Mailer.layer),
    Layer.provideMerge(Postmark.layer()),
    Layer.provideMerge(Testing.layer),
    Layer.provide(
      ConfigProvider.layerAdd(
        ConfigProvider.fromUnknown({ POSTMARK_SERVER_TOKEN: "postmark-token", EMAIL_FROM: "Ren <hello@ren.ai>" }),
        { asPrimary: true },
      ),
    ),
  ),
)

const signIn = Effect.fnUntraced(function* (userId: Auth.UserID) {
  const database = yield* Database.Service
  const clientId = `client-${userId}`
  yield* database.db.insert(Database.Schema.session).values(
    ["web", "mobile"].map((name) => ({
      id: Auth.SessionID.create(),
      token: `${name}-${userId}`,
      userId,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })),
  )
  yield* database.db.insert(Database.Schema.oauthClient).values({ id: clientId, clientId, redirectUris: [] })
  yield* database.db
    .insert(Database.Schema.oauthRefreshToken)
    .values({ id: `refresh-${userId}`, token: `refresh-${userId}`, clientId, userId, scopes: ["ren"] })
  yield* database.db
    .insert(Database.Schema.oauthAccessToken)
    .values({ id: `access-${userId}`, token: `access-${userId}`, clientId, userId, scopes: ["ren"] })
})

const credentials = Effect.fnUntraced(function* (userId: Auth.UserID) {
  const database = yield* Database.Service
  return [
    ...(yield* database.db.select().from(Database.Schema.session).where(eq(Database.Schema.session.userId, userId))),
    ...(yield* database.db
      .select()
      .from(Database.Schema.oauthRefreshToken)
      .where(eq(Database.Schema.oauthRefreshToken.userId, userId))),
    ...(yield* database.db
      .select()
      .from(Database.Schema.oauthAccessToken)
      .where(eq(Database.Schema.oauthAccessToken.userId, userId))),
  ]
})

describe("AccountDeletion", () => {
  it.live("archives the account, signs the user out everywhere and emails them once", () =>
    Effect.gen(function* () {
      const deletion = yield* AccountDeletion.Service
      const outbox = yield* Postmark.Outbox
      const ada = yield* Seed.user({ email: "ada@example.com" })
      const grace = yield* Seed.user({ email: "grace@example.com" })
      yield* signIn(ada.id)
      yield* signIn(grace.id)
      expect(yield* deletion.isArchived(ada.id)).toBe(false)

      yield* deletion.request(ada)
      yield* deletion.request(ada)

      expect(yield* deletion.isArchived(ada.id)).toBe(true)
      expect(yield* deletion.isArchived(grace.id)).toBe(false)
      expect(yield* credentials(ada.id)).toHaveLength(0)
      expect(yield* credentials(grace.id)).toHaveLength(4)
      const sent = (yield* outbox.next).message
      expect(sent).toMatchObject({
        To: "ada@example.com",
        Subject: "We’ve received your request to delete your Ren account",
      })
      expect(sent.TextBody).toContain("within 7 days, and we’ll email you again when it’s done")
      yield* deletion.request(grace)
      expect((yield* outbox.next).message.To).toBe("grace@example.com")
    }),
  )

  it.live("refuses while the user is the only owner of an organization with other members", () =>
    Effect.gen(function* () {
      const deletion = yield* AccountDeletion.Service
      const team = yield* Seed.organization()
      const ada = yield* Seed.user()
      const grace = yield* Seed.user()
      yield* Seed.member(team, ada.id, "owner")
      yield* Seed.member(team, grace.id, "admin")
      yield* Seed.member(yield* Seed.organization(), ada.id, "owner")

      expect(yield* Effect.flip(deletion.request(ada))).toMatchObject({
        _tag: "AccountDeletion.SoleOwner",
        message:
          "You’re the only owner of Northstar. Make another member an owner before you delete your account, or contact support@renai.build.",
      })
      expect(yield* deletion.isArchived(ada.id)).toBe(false)

      const database = yield* Database.Service
      yield* database.db
        .update(Database.Schema.member)
        .set({ role: "admin,owner" })
        .where(eq(Database.Schema.member.userId, grace.id))
      yield* deletion.request(ada)
      expect(yield* deletion.isArchived(ada.id)).toBe(true)
    }),
  )
})

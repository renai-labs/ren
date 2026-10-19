import { describe, expect } from "bun:test"
import { EnvironmentToken } from "@ren/hand-api/environment-token"
import { Signature } from "@ren/hand-api/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Environment } from "@ren/schema/environment"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Context, DateTime, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import { HandProviders } from "../src/hand-providers.js"
import { Hands } from "../src/hands.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/hand-provider.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

const keys = await Effect.runPromise(Effect.all([Signature.generate("new"), Signature.generate("old")]))

const signingKeys = JSON.stringify(
  keys.map((pair) => ({
    id: pair.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(pair.privateKey.key),
  })),
)

const handsWith = Effect.fnUntraced(function* (
  config: Readonly<Record<string, string>> = {},
  options: Parameters<typeof TestProvider.make>[0] = {},
) {
  const probe = yield* TestProvider.make(options)
  const context = yield* Layer.build(
    Layer.fresh(Hands.layer).pipe(
      Layer.provide(HandProviders.layer([Effect.succeed(probe.provider)])),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVIRONMENT_KEYS: signingKeys, ...config }))),
    ),
  )
  return { hands: Context.get(context, Hands.Service), probe }
})

const subjectIn = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  return { sessionId: Session.ID.create(), organizationId, spaceId: yield* Seed.team(organizationId) }
})

const handsOf = Effect.fnUntraced(function* (environmentId: Environment.ID) {
  const database = yield* Database.Service
  return yield* database.db
    .select({
      handId: Database.Schema.hand.id,
      sessions: sql<number>`(select count(*)::int from ${Database.Schema.session_environment} where ${Database.Schema.session_environment.hand_id} = ${Database.Schema.hand.id})`,
    })
    .from(Database.Schema.hand)
    .where(eq(Database.Schema.hand.environment_id, environmentId))
})

describe("Hands", () => {
  it.live("binds a session to its organization's environment, with no hand yet", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId)
      const session = yield* subjectIn(organizationId)
      const binding = yield* subject.hands.bind(session, environmentId)
      expect(binding).toEqual({ directory: `/workspace/${session.sessionId}`, isNew: true })
      expect(yield* subject.hands.find(session)).toEqual(Option.some(binding.directory))
      expect(yield* subject.hands.find({ ...session, organizationId: yield* Seed.organization() })).toEqual(
        Option.none(),
      )
      expect(yield* Ref.get(subject.probe.provisions)).toEqual([])
    }),
  )

  it.live("a session keeps its environment, and another organization's environment is not found", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId)
      const other = yield* Seed.environment(organizationId)
      const foreign = yield* Seed.environment(yield* Seed.organization())
      const session = yield* subjectIn(organizationId)
      yield* subject.hands.bind(session, environmentId)
      expect((yield* subject.hands.bind(session, environmentId)).isNew).toBe(false)
      expect((yield* subject.hands.bind(session, other).pipe(Effect.flip))._tag).toBe("Hands.Changed")
      expect((yield* subject.hands.bind(yield* subjectIn(organizationId), foreign).pipe(Effect.flip))._tag).toBe(
        "Hands.NotFound",
      )
      expect((yield* subject.hands.access(yield* subjectIn(organizationId)).pipe(Effect.flip))._tag).toBe(
        "Hands.NotFound",
      )
    }),
  )

  it.live("a session uses only an environment linked to its space, and loses it when the link goes", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId)
      const session = yield* subjectIn(organizationId)
      const elsewhere = { ...session, sessionId: Session.ID.create(), spaceId: Space.ID.create() }
      expect((yield* subject.hands.bind(elsewhere, environmentId).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      yield* subject.hands.bind(session, environmentId)
      yield* subject.hands.access(session)
      yield* database.db
        .update(Database.Schema.space_environment)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.space_environment.environment_id, environmentId))
      expect((yield* subject.hands.access(session).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      expect(yield* subject.hands.find(session)).toEqual(Option.none())
    }),
  )

  it.live(
    "the first access makes a hand and a token for the session's brain, signed with the first key; the next reuses it",
    () =>
      Effect.gen(function* () {
        const subject = yield* handsWith()
        const organizationId = yield* Seed.organization()
        const environmentId = yield* Seed.environment(organizationId)
        const session = yield* subjectIn(organizationId)
        yield* subject.hands.bind(session, environmentId)
        const before = Date.now()
        const access = yield* subject.hands.access(session)
        const again = yield* subject.hands.access(session)
        const provisions = yield* Ref.get(subject.probe.provisions)
        expect(provisions.length).toBe(1)
        expect([access.directory, access.generation]).toEqual([`/workspace/${session.sessionId}`, 1])
        expect(again.url.href).toBe(access.url.href)
        const claims = yield* EnvironmentToken.verify([keys[0].publicKey], Redacted.value(access.token))
        expect(Option.map(claims, (found) => [found.kid, found.env, found.brain])).toEqual(
          Option.some(["new", environmentId, Brain.ofSession(session.sessionId)]),
        )
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(14 * 60_000)
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(15 * 60_000)
      }),
  )

  it.live("a configured token lifetime is the access's lifetime", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith({ ENVIRONMENT_TOKEN_LIFETIME: "20 seconds" })
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.hands.bind(session, yield* Seed.environment(organizationId))
      const before = Date.now()
      const access = yield* subject.hands.access(session)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(20_000)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(18_000)
    }),
  )

  it.live("sessions that ask at once share hands, never more than sessionsPerHand on one", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId, { sessionsPerHand: 2 })
      const sessions = yield* Effect.all(Array.from({ length: 5 }, () => subjectIn(organizationId)))
      yield* Effect.forEach(sessions, (session) => subject.hands.bind(session, environmentId), { discard: true })
      yield* Effect.forEach(sessions, (session) => subject.hands.access(session), { concurrency: "unbounded" })
      const made = yield* handsOf(environmentId)
      expect(made.map((hand) => hand.sessions).toSorted((left, right) => left - right)).toEqual([1, 2, 2])
      expect((yield* Ref.get(subject.probe.provisions)).length).toBe(3)
    }),
  )

  it.live("a hand that is gone is replaced once; the sessions on it get the next generation", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId)
      const sessions = yield* Effect.all([subjectIn(organizationId), subjectIn(organizationId)])
      yield* Effect.forEach(sessions, (session) => subject.hands.bind(session, environmentId), { discard: true })
      const first = yield* Effect.forEach(sessions, (session) => subject.hands.access(session))
      const lost = (yield* Ref.get(subject.probe.provisions))[0]
      if (!lost) return yield* Effect.die(new Error("no hand was made"))
      yield* Ref.set(subject.probe.gone, new Set([lost]))
      const replaced = yield* Effect.forEach(sessions, (session) => subject.hands.access(session))
      expect(replaced.map((access) => access.generation)).toEqual([2, 2])
      expect(replaced.at(0)?.url.href).not.toBe(first.at(0)?.url.href)
      expect(replaced.at(1)?.url.href).toBe(replaced.at(0)?.url.href)
      expect((yield* handsOf(environmentId)).length).toBe(1)
    }),
  )

  it.live("a provider that fails gives Unavailable, and the next access tries again", () =>
    Effect.gen(function* () {
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.hands.bind(session, yield* Seed.environment(organizationId))
      yield* Ref.set(subject.probe.failing, true)
      const failed = yield* subject.hands.access(session).pipe(Effect.flip)
      expect([failed._tag, failed.message]).toEqual([
        "Hands.Unavailable",
        `The hand of session ${session.sessionId} is unavailable: the test provider fails`,
      ])
      yield* Ref.set(subject.probe.failing, false)
      expect((yield* subject.hands.access(session)).generation).toBe(1)
    }),
  )

  it.live("an archived environment gives no access, and a provider this deployment lacks gives no binding", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* handsWith()
      const organizationId = yield* Seed.organization()
      const environmentId = yield* Seed.environment(organizationId)
      const session = yield* subjectIn(organizationId)
      yield* subject.hands.bind(session, environmentId)
      yield* database.db
        .update(Database.Schema.environment)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.environment.id, environmentId))
      expect((yield* subject.hands.access(session).pipe(Effect.flip))._tag).toBe("Hands.NotFound")
      const elsewhere = yield* Seed.environment(organizationId, { provider: "e2b" })
      expect((yield* subject.hands.bind(yield* subjectIn(organizationId), elsewhere).pipe(Effect.flip))._tag).toBe(
        "Hands.NotFound",
      )
    }),
  )
})

import { HttpClient, HttpClientError } from "effect/http"
import { describe, expect } from "bun:test"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { eq, sql } from "drizzle-orm"
import { ConfigProvider, Context, DateTime, Effect, Layer, Option, Redacted, Ref, Schema } from "effect"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

const it = testEffect(Testing.layer)

const keys = await Effect.runPromise(Effect.all([Signature.generate("new"), Signature.generate("old")]))

const signingKeys = JSON.stringify(
  keys.map((pair) => ({
    id: pair.privateKey.id,
    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(pair.privateKey.key),
  })),
)

// oxlint-disable-next-line ren/no-comments -- The test machines run no executor, so a probe of one gets no answer.
const noExecutor = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({ request, description: "no executor runs in this test" }),
      }),
    ),
  ),
)

const environmentsWith = Effect.fnUntraced(function* (
  config: Readonly<Record<string, string>> = {},
  options: Parameters<typeof TestProvider.make>[0] = {},
) {
  const probe = yield* TestProvider.make(options)
  const context = yield* Layer.build(
    Layer.fresh(Environments.layer.pipe(Layer.provide([Signer.layerLocal, noExecutor]))).pipe(
      Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVIRONMENT_KEYS: signingKeys, ...config }))),
    ),
  )
  return { environments: Context.get(context, Environments.Service), probe }
})

const subjectIn = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
  return yield* Seed.subject(organizationId, yield* Seed.team(organizationId))
})

const environmentsOf = Effect.fnUntraced(function* (environmentTemplateId: EnvironmentTemplate.ID) {
  const database = yield* Database.Service
  return yield* database.db
    .select({
      environmentId: Database.Schema.environment.id,
      sessions: sql<number>`(select count(*)::int from ${Database.Schema.session_environment} where ${Database.Schema.session_environment.environment_id} = ${Database.Schema.environment.id})`,
    })
    .from(Database.Schema.environment)
    .where(eq(Database.Schema.environment.environment_template_id, environmentTemplateId))
})

describe("Environments", () => {
  it.live("binds a session to its organization's environment template, with no environment yet", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      const session = yield* subjectIn(organizationId)
      const binding = yield* subject.environments.bind(session, environmentTemplateId)
      expect(binding).toEqual({ directory: `/workspace/${session.sessionId}`, isNew: true })
      expect(yield* subject.environments.findDirectory(session, Option.none())).toEqual(Option.some(binding.directory))
      expect(
        yield* subject.environments.findDirectory(
          { ...session, organizationId: yield* Seed.organization() },
          Option.none(),
        ),
      ).toEqual(Option.none())
      expect(yield* Ref.get(subject.probe.provisions)).toEqual([])
    }),
  )

  it.live(
    "a session keeps its environment template, and another organization's environment template is not found",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const other = yield* Seed.environmentTemplate(organizationId)
        const foreign = yield* Seed.environmentTemplate(yield* Seed.organization())
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        expect((yield* subject.environments.bind(session, environmentTemplateId)).isNew).toBe(false)
        expect((yield* subject.environments.bind(session, other).pipe(Effect.flip))._tag).toBe("Environments.Changed")
        expect(
          (yield* subject.environments.bind(yield* subjectIn(organizationId), foreign).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
        expect(
          (yield* subject.environments.access(yield* subjectIn(organizationId), Option.none()).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
      }),
  )

  it.live(
    "the first access makes an environment and a token for the session's brain, signed with the first key; the next reuses it",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        const before = Date.now()
        const access = yield* subject.environments.access(session, Option.none())
        const again = yield* subject.environments.access(session, Option.none())
        const provisions = yield* Ref.get(subject.probe.provisions)
        expect(provisions.length).toBe(1)
        expect([access.directory, access.generation]).toEqual([`/workspace/${session.sessionId}`, 1])
        expect(again.url.href).toBe(access.url.href)
        const claims = yield* EnvironmentToken.verify([keys[0].publicKey], Redacted.value(access.token))
        expect(Option.map(claims, (found) => [found.kid, found.environment, found.brain])).toEqual(
          Option.some(["new", ...provisions, Brain.ofSession(session.sessionId)]),
        )
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(14 * 60_000)
        expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(15 * 60_000)
      }),
  )

  it.live("an access names the folder that the environment's sessions share and the egress of its provider", () =>
    Effect.gen(function* () {
      const egressOf = Effect.fnUntraced(function* (egress: boolean) {
        const subject = yield* environmentsWith({}, { egress })
        const organizationId = yield* Seed.organization()
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
        const access = yield* subject.environments.access(session, Option.none())
        return [access.sharedDirectory, access.egress]
      })
      expect(yield* egressOf(false)).toEqual(["/workspace/.ren", false])
      expect(yield* egressOf(true)).toEqual(["/workspace/.ren", true])
    }),
  )

  it.live("a configured token lifetime is the access's lifetime", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith({ ENVIRONMENT_TOKEN_LIFETIME: "20 seconds" })
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      const before = Date.now()
      const access = yield* subject.environments.access(session, Option.none())
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeLessThanOrEqual(20_000)
      expect(DateTime.toEpochMillis(access.expiresAt) - before).toBeGreaterThan(18_000)
    }),
  )

  it.live("sessions that ask at once share environments, never more than sessionsPerEnvironment on one", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 2 })
      const spaceId = yield* Seed.team(organizationId)
      const sessions = yield* Effect.all(Array.from({ length: 5 }, () => Seed.subject(organizationId, spaceId)))
      yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
        discard: true,
      })
      yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()), {
        concurrency: "unbounded",
      })
      const made = yield* environmentsOf(environmentTemplateId)
      expect(made.map((environment) => environment.sessions).toSorted((left, right) => left - right)).toEqual([1, 2, 2])
      expect((yield* Ref.get(subject.probe.provisions)).length).toBe(3)
    }),
  )

  it.live(
    "one template that two spaces use never puts their sessions in one environment (private-spaces test 10)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 4 })
        const shared = yield* subjectIn(organizationId)
        const otherSpace = yield* Seed.space(organizationId)
        const other = yield* Seed.subject(organizationId, otherSpace)
        yield* Effect.forEach([shared, other], (session) => subject.environments.bind(session, environmentTemplateId), {
          discard: true,
        })
        yield* Effect.forEach([shared, other], (session) => subject.environments.access(session, Option.none()), {
          discard: true,
        })
        expect((yield* environmentsOf(environmentTemplateId)).map((environment) => environment.sessions)).toEqual([
          1, 1,
        ])
      }),
  )

  it.live(
    "a hand that the brain cannot reach and whose machine is gone is replaced once; the sessions on it get the next generation (EN15)",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const sessions = yield* Effect.all([subjectIn(organizationId), subjectIn(organizationId)])
        yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, environmentTemplateId), {
          discard: true,
        })
        yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()))
        const lost = (yield* Ref.get(subject.probe.provisions))[0]
        if (!lost) return yield* Effect.die(new Error("no environment was made"))
        yield* Ref.set(subject.probe.gone, new Set([lost]))
        const kept = yield* subject.environments.access(sessions[1], Option.none())
        const replaced = yield* subject.environments.access(sessions[0], Option.none(), { unreachable: true })
        const again = yield* subject.environments.access(sessions[1], Option.none())
        expect([kept.generation, replaced.generation, again.generation]).toEqual([1, 2, 2])
        expect(yield* Ref.get(subject.probe.provisions)).toEqual([lost, lost])
        expect((yield* environmentsOf(environmentTemplateId)).length).toBe(1)
      }),
  )

  it.live(
    "a provider that fails 3 times gives Unavailable, and the timed retry starts it again (EN19, chaos row 33)",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
        yield* Ref.set(subject.probe.failing, true)
        const failed = yield* subject.environments.access(session, Option.none()).pipe(Effect.flip)
        expect([failed._tag, failed.message]).toEqual([
          "Environments.Unavailable",
          `The environment of session ${session.sessionId} is unavailable: the test provider fails`,
        ])
        yield* Ref.set(subject.probe.failing, false)
        yield* database.db
          .update(Database.Schema.environment)
          .set({ retry_at: new Date(Date.now() - 1000) })
          .where(eq(Database.Schema.environment.phase, "failed"))
        expect((yield* subject.environments.access(session, Option.none())).generation).toBe(1)
      }),
  )

  it.live(
    "an archived environment template gives no access, and a provider this deployment lacks gives no binding",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, environmentTemplateId)
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
        expect((yield* subject.environments.access(session, Option.none()).pipe(Effect.flip))._tag).toBe(
          "Environments.NotFound",
        )
        const elsewhere = yield* Seed.environmentTemplate(organizationId, { provider: "e2b" })
        expect(
          (yield* subject.environments.bind(yield* subjectIn(organizationId), elsewhere).pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
      }),
  )
})

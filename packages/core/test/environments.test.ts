import { HttpClient, HttpClientError } from "effect/http"
import { Bundles } from "../src/bundles.js"
import { describe, expect } from "bun:test"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import type { Session } from "@ren/schema/session"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { eq, sql } from "drizzle-orm"
import {
  ConfigProvider,
  Context,
  DateTime,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Schedule,
  Schema,
} from "effect"
import { TestClock } from "effect/testing"
import { CredentialCallers } from "../src/credential-callers.js"
import { EnvironmentNetwork } from "../src/environment-network.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { TestSandboxEgress } from "./lib/sandbox-egress.js"
import { Seed } from "./lib/seed.js"
import { SandboxEgress } from "../src/sandbox-egress.js"
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
  ren: {
    readonly hasEgress?: boolean
    readonly network?: Layer.Layer<EnvironmentNetwork.Service>
  } = {},
) {
  const probe = yield* TestProvider.make(options)
  const context = yield* Layer.build(
    Layer.fresh(
      Environments.layer.pipe(
        Layer.provide([noExecutor, ren.network ?? EnvironmentNetwork.layerNone]),
        Layer.provide(Bundles.layer),
        Layer.provide(Signer.layerLocal),
        Layer.provide(ren.hasEgress ? Layer.empty : SandboxEgress.layerNone),
        Layer.provideMerge(TestSandboxEgress.layer),
      ),
    ).pipe(
      Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ ENVIRONMENT_KEYS: signingKeys, ...config }))),
    ),
  )
  return {
    environments: Context.get(context, Environments.Service),
    callers: Context.get(context, CredentialCallers.Service),
    probe,
  }
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

  it.live(
    "a remote hand goes through Ren's egress with its own proxy login when its provider can, and its access says so; without an egress it gets none (C2)",
    () =>
      Effect.gen(function* () {
        const egressOf = Effect.fnUntraced(function* (options: {
          readonly canEgress: boolean
          readonly hasEgress: boolean
        }) {
          const subject = yield* environmentsWith({}, { egress: options.canEgress }, { hasEgress: options.hasEgress })
          const organizationId = yield* Seed.organization()
          const session = yield* subjectIn(organizationId)
          yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
          const access = yield* subject.environments.access(session, Option.none())
          const proxy = Option.flatMap(
            Option.fromNullishOr((yield* Ref.get(subject.probe.networks)).at(0)),
            (network) => network.proxy,
          )
          const verified = Option.isSome(proxy)
            ? yield* subject.callers.verify({
                kind: "ProxyLogin",
                username: proxy.value.username,
                password: proxy.value.password,
              })
            : undefined
          return { sharedDirectory: access.sharedDirectory, egress: access.egress, verified }
        })
        expect(yield* egressOf({ canEgress: true, hasEgress: true })).toEqual({
          sharedDirectory: "/workspace/.ren",
          egress: true,
          verified: {
            ok: true,
            caller: {
              workload: { kind: "hand", id: expect.any(String), generation: 1 },
              organizationId: expect.any(String),
            },
          },
        })
        expect(yield* egressOf({ canEgress: false, hasEgress: true })).toMatchObject({
          egress: false,
          verified: undefined,
        })
        expect(yield* egressOf({ canEgress: true, hasEgress: false })).toMatchObject({
          egress: false,
          verified: undefined,
        })
      }),
  )

  it.live("a limited remote hand also reaches Ren's server, where it fetches Ren's code at its start", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* environmentsWith(
        { REN_URL: "https://ren.example.com" },
        { canLimitHosts: true },
        { network: EnvironmentNetwork.layerNone },
      )
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      yield* database.db
        .update(Database.Schema.environment_template)
        .set({
          networking: {
            type: "limited",
            allowPackageManagers: false,
            allowMcpServers: false,
            allowedHosts: ["api.example.com"],
          },
        })
        .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
      yield* subject.environments.bind(session, environmentTemplateId)
      yield* subject.environments.access(session, Option.none())
      expect((yield* Ref.get(subject.probe.networks)).map((network) => network.hosts)).toEqual([
        Option.some(["api.example.com", "ren.example.com"]),
      ])
    }),
  )

  it.live("a chat's background process keeps its remote hand awake, as it keeps the brain (EN25)", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      yield* subject.environments.access(session, Option.none())
      const environmentId = (yield* database.db
        .select({ id: Database.Schema.session_environment.environment_id })
        .from(Database.Schema.session_environment)
        .where(eq(Database.Schema.session_environment.session_id, session.sessionId))).at(0)?.id
      if (!environmentId) return yield* Effect.die(new Error("The session has no environment"))
      yield* database.db
        .update(Database.Schema.environment)
        .set({ keep_alive_until: new Date(Date.now() + 60_000) })
        .where(eq(Database.Schema.environment.id, environmentId))
      yield* Ref.set(subject.probe.keptAlive, [])
      yield* subject.environments.keepAwake([session.sessionId], new Date())
      expect(yield* Ref.get(subject.probe.keptAlive)).toEqual([environmentId])
    }),
  )

  it.live("a remote hand on older Ren code is replaced at its wake, so it never lags its brains (EN27, EN33)", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const bundle = (kind: "dependencies" | "brain" | "executor", version: string) =>
        database.db
          .insert(Database.Schema.bundle)
          .values({ kind, version, sha256: "0".repeat(64), built_at: new Date() })
          .onConflictDoUpdate({ target: Database.Schema.bundle.kind, set: { version } })
      yield* bundle("dependencies", "d000000000000001")
      yield* bundle("brain", "b000000000000001")
      yield* bundle("executor", "e000000000000001")
      const subject = yield* environmentsWith({ BRAIN_KEYS: signingKeys })
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
      yield* subject.environments.access(session, Option.none())
      yield* bundle("executor", "e000000000000002")
      yield* database.db.update(Database.Schema.environment).set({ keep_alive_until: new Date(Date.now() - 1000) })
      yield* subject.environments.access(session, Option.none()).pipe(Effect.ignore)
      expect(
        (yield* Ref.get(subject.probe.provisions).pipe(
          Effect.repeat({ until: (all) => all.length === 2, schedule: Schedule.spaced("20 millis") }),
          Effect.timeoutOption("3 seconds"),
        )).pipe(Option.map((all) => all.length)),
      ).toEqual(Option.some(2))
    }),
  )

  it.live("cleanup destroys a hand sandbox that no row knows at its generation, and keeps the others", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const template = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 1 })
      const sessions = [yield* subjectIn(organizationId), yield* subjectIn(organizationId)]
      yield* Effect.forEach(sessions, (session) =>
        subject.environments
          .bind(session, template)
          .pipe(Effect.andThen(subject.environments.access(session, Option.none()))),
      )
      const made = yield* Ref.get(subject.probe.provisions)
      const lost = made.at(1)
      if (!lost) return yield* Effect.die(new Error("Two hands were not made"))
      yield* database.db
        .update(Database.Schema.environment)
        .set({ generation: 2, binding: null })
        .where(eq(Database.Schema.environment.id, lost))
      yield* subject.environments.cleanup
      expect(yield* Ref.get(subject.probe.destroyed)).toEqual([lost])
    }),
  )

  it.live(
    "the idle chats a pull names follow their space's current hand: another template, the brain's own machine, then remote again; a busy chat keeps its hand",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const spaceId = yield* Seed.team(organizationId)
        const idle = yield* Seed.subject(organizationId, spaceId)
        const busy = yield* Seed.subject(organizationId, spaceId)
        const space = { organizationId, spaceId }
        const first = yield* Seed.environmentTemplate(organizationId)
        const second = yield* Seed.environmentTemplate(organizationId)
        const handIs = (hand: {
          readonly hand_placement: "colocated" | "remote"
          readonly environment_template_id: EnvironmentTemplate.ID | null
        }) => database.db.update(Database.Schema.space).set(hand).where(eq(Database.Schema.space.id, spaceId))
        const bound = (sessionId: Session.ID) =>
          database.db
            .select({ template: Database.Schema.session_environment.environment_template_id })
            .from(Database.Schema.session_environment)
            .where(eq(Database.Schema.session_environment.session_id, sessionId))
            .pipe(Effect.map((rows) => rows.at(0)?.template ?? null))
        yield* handIs({ hand_placement: "remote", environment_template_id: first })
        yield* subject.environments.bind(idle, first)
        yield* subject.environments.bind(busy, first)
        yield* handIs({ hand_placement: "remote", environment_template_id: second })
        yield* subject.environments.follow(space, [idle.sessionId])
        const afterSecond = [yield* bound(idle.sessionId), yield* bound(busy.sessionId)]
        yield* handIs({ hand_placement: "colocated", environment_template_id: null })
        yield* subject.environments.follow(space, [idle.sessionId])
        const afterOwn = yield* bound(idle.sessionId)
        yield* handIs({ hand_placement: "remote", environment_template_id: first })
        yield* subject.environments.follow(space, [idle.sessionId])
        expect([afterSecond, afterOwn, yield* bound(idle.sessionId)]).toEqual([[second, first], null, first])
      }),
  )

  it.live("a brain with a host list reaches the machines of its space's remote hand, and no other hand's hosts", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const subject = yield* environmentsWith({}, { machineHosts: ["*.hands.test"] })
      const organizationId = yield* Seed.organization()
      const spaceId = yield* Seed.team(organizationId)
      const template = yield* Seed.environmentTemplate(organizationId)
      const handIs = (hand: {
        readonly hand_placement: "colocated" | "remote"
        readonly environment_template_id: EnvironmentTemplate.ID | null
      }) => database.db.update(Database.Schema.space).set(hand).where(eq(Database.Schema.space.id, spaceId))
      yield* handIs({ hand_placement: "remote", environment_template_id: template })
      const remote = yield* subject.environments.handHosts(spaceId)
      yield* handIs({ hand_placement: "colocated", environment_template_id: null })
      expect([remote, yield* subject.environments.handHosts(spaceId)]).toEqual([["*.hands.test"], []])
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

  it.effect(
    "an access waits 5 s for a hand that is starting, then answers Starting; once the machine is made the next access gives it",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const made = yield* Deferred.make<void>()
        const subject = yield* environmentsWith(
          {},
          { creating: Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(made))) },
        )
        const organizationId = yield* Seed.organization()
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
        const first = yield* subject.environments.access(session, Option.none()).pipe(Effect.flip, Effect.forkScoped)
        yield* Deferred.await(entered)
        yield* TestClock.adjust(Environments.startingAfter)
        expect((yield* Fiber.join(first))._tag).toBe("Environments.Starting")
        yield* Deferred.succeed(made, undefined)
        expect((yield* subject.environments.access(session, Option.none())).generation).toBe(1)
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
    "a provider that fails 3 times gives Unavailable to a caller that asks again while it is Starting, and the timed retry starts it again (EN19, chaos row 33)",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const session = yield* subjectIn(organizationId)
        yield* subject.environments.bind(session, yield* Seed.environmentTemplate(organizationId))
        yield* Ref.set(subject.probe.failing, true)
        const failed = yield* subject.environments
          .access(session, Option.none())
          .pipe(Effect.flip, Effect.repeat({ while: (error) => error._tag === "Environments.Starting" }))
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

import { HttpClient } from "effect/http"
import { Bundles } from "../src/bundles.js"
import { describe, expect } from "bun:test"
import { EnvironmentToken } from "@ren/environment-api/environment-token"
import { Signature } from "@ren/schema/signature"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import type { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import type { Session } from "@ren/schema/session"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { eq, inArray, sql } from "drizzle-orm"
import {
  ConfigProvider,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Ref,
  Schedule,
  Schema,
} from "effect"
import { SqlClient } from "effect/sql"
import { TestClock } from "effect/testing"
import { CredentialCallers } from "../src/credential-callers.js"
import { EnvironmentNetwork } from "../src/environment-network.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { DurableRunner } from "../src/durable-runner.js"
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
        Layer.provide(DurableRunner.layerMemory),
        Layer.provide([
          Layer.succeed(HttpClient.HttpClient, probe.executor),
          ren.network ?? EnvironmentNetwork.layerNone,
        ]),
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

const bindingOf = Effect.fnUntraced(function* (session: { readonly sessionId: Session.ID }) {
  const database = yield* Database.Service
  const found = (yield* database.db
    .select({
      environmentId: Database.Schema.session_environment.environment_id,
      reservedUntil: Database.Schema.session_environment.reserved_until,
    })
    .from(Database.Schema.session_environment)
    .where(eq(Database.Schema.session_environment.session_id, session.sessionId))).at(0)
  if (!found) return yield* Effect.die(new Error(`Session ${session.sessionId} has no binding`))
  return found
})

describe("Environments", () => {
  it.live("binds a session to its organization's environment template, with no environment yet", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const environmentTemplateId = yield* Seed.environmentTemplate(organizationId)
      const session = yield* subjectIn(organizationId)
      const binding = yield* subject.environments.bind(session, Seed.version(environmentTemplateId))
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
        yield* subject.environments.bind(session, Seed.version(environmentTemplateId))
        expect((yield* subject.environments.bind(session, Seed.version(environmentTemplateId))).isNew).toBe(false)
        expect((yield* subject.environments.bind(session, Seed.version(other)).pipe(Effect.flip))._tag).toBe(
          "Environments.Changed",
        )
        expect(
          (yield* subject.environments.bind(yield* subjectIn(organizationId), Seed.version(foreign)).pipe(Effect.flip))
            ._tag,
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
        yield* subject.environments.bind(session, Seed.version(environmentTemplateId))
        const before = Date.now()
        const access = yield* subject.environments.access(session, Option.none())
        const after = Date.now()
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
        expect(DateTime.toEpochMillis(access.expiresAt) - after).toBeLessThanOrEqual(15 * 60_000)
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
          yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
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
      yield* subject.environments.bind(session, Seed.version(environmentTemplateId))
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
      yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
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
      yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
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
          .bind(session, Seed.version(template))
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
    "a chat holds its place on its machine for 3 days: a turn renews a held place, and an expired place gives the room to another chat",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const template = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 1 })
        const [first, second] = yield* Effect.all([subjectIn(organizationId), subjectIn(organizationId)])
        yield* Effect.forEach([first, second], (session) => subject.environments.bind(session, Seed.version(template)))
        yield* subject.environments.access(first, Option.none())
        const holdUntil = (session: typeof first, until: Date) =>
          database.db
            .update(Database.Schema.session_environment)
            .set({ reserved_until: until })
            .where(eq(Database.Schema.session_environment.session_id, session.sessionId))
        yield* holdUntil(first, new Date(Date.now() + Duration.toMillis("1 hour")))
        yield* subject.environments.renew([first.sessionId])
        const renewed = (yield* bindingOf(first)).reservedUntil
        yield* holdUntil(first, new Date(Date.now() - 1000))
        yield* subject.environments.renew([first.sessionId])
        const expired = (yield* bindingOf(first)).reservedUntil
        yield* subject.environments.access(second, Option.none())
        yield* subject.environments.access(first, Option.none())
        const machines = yield* Ref.get(subject.probe.provisions)
        expect({
          isRenewed: (renewed?.getTime() ?? 0) > Date.now() + Duration.toMillis("2 days"),
          isExpiredKept: (expired?.getTime() ?? Date.now()) < Date.now(),
          second: (yield* bindingOf(second)).environmentId,
          first: (yield* bindingOf(first)).environmentId,
        }).toEqual({ isRenewed: true, isExpiredKept: true, second: machines[0] ?? null, first: machines[1] ?? null })
      }),
  )

  it.live(
    "a template that allows fewer chats per machine keeps the places held now, and gives no new place there",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const template = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 2 })
        const sessions = yield* Effect.all([
          subjectIn(organizationId),
          subjectIn(organizationId),
          subjectIn(organizationId),
        ])
        yield* Effect.forEach(sessions, (session) => subject.environments.bind(session, Seed.version(template)))
        yield* Effect.forEach(sessions.slice(0, 2), (session) => subject.environments.access(session, Option.none()))
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ sessions_per_environment: 1 })
          .where(eq(Database.Schema.environment_template.id, template))
        yield* Effect.forEach(sessions, (session) => subject.environments.access(session, Option.none()))
        const machines = yield* Ref.get(subject.probe.provisions)
        expect(
          yield* Effect.forEach(sessions, (session) => Effect.map(bindingOf(session), (found) => found.environmentId)),
        ).toEqual([machines[0] ?? null, machines[0] ?? null, machines[1] ?? null])
      }),
  )

  it.live(
    "a chat whose brain applied a new template version gets a machine of that version, another chat keeps the old one until its brain does, and a replaced machine runs its own version",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const template = yield* Seed.environmentTemplate(organizationId)
        const versionOf = (image: string) => ({
          environmentTemplateId: template,
          image,
          config: { label: "seeded" },
          system: null,
        })
        const [first, second] = yield* Effect.all([subjectIn(organizationId), subjectIn(organizationId)])
        yield* Effect.forEach([first, second], (session) => subject.environments.bind(session, versionOf("image-1")))
        yield* Effect.forEach([first, second], (session) => subject.environments.access(session, Option.none()))
        const applies = (session: typeof first, image: string) =>
          database.db
            .update(Database.Schema.session_environment)
            .set({ target: versionOf(image) })
            .where(eq(Database.Schema.session_environment.session_id, session.sessionId))
        yield* applies(first, "image-2")
        yield* subject.environments.access(first, Option.none())
        const split = [(yield* bindingOf(first)).environmentId, (yield* bindingOf(second)).environmentId]
        yield* applies(second, "image-2")
        yield* subject.environments.access(second, Option.none())
        const joined = (yield* bindingOf(second)).environmentId
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ image: "image-3", image_config: { label: "seeded" } })
          .where(eq(Database.Schema.environment_template.id, template))
        const newer = split[0]
        if (!newer) return yield* Effect.die(new Error("The chat has no machine"))
        yield* Ref.set(subject.probe.gone, new Set([newer]))
        yield* subject.environments.access(first, Option.none(), { unreachable: true })
        const machines = yield* Ref.get(subject.probe.provisions)
        expect({ split, joined, images: yield* Ref.get(subject.probe.images) }).toEqual({
          split: [machines[1] ?? null, machines[0] ?? null],
          joined: machines[1] ?? null,
          images: ["image-1", "image-2", "image-2"],
        })
      }),
  )

  it.live(
    "the daily cleanup destroys a machine that no chat holds and that runs no work, and keeps a held one and an awake one",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const subject = yield* environmentsWith({}, {}, { hasEgress: true })
        const organizationId = yield* Seed.organization()
        const template = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 1 })
        const sessions = yield* Effect.all([
          subjectIn(organizationId),
          subjectIn(organizationId),
          subjectIn(organizationId),
        ])
        yield* Effect.forEach(sessions, (session) =>
          subject.environments
            .bind(session, Seed.version(template))
            .pipe(Effect.andThen(subject.environments.access(session, Option.none()))),
        )
        const machines = yield* Ref.get(subject.probe.provisions)
        const past = new Date(Date.now() - 1000)
        yield* database.db
          .update(Database.Schema.session_environment)
          .set({ reserved_until: past })
          .where(
            inArray(Database.Schema.session_environment.session_id, [sessions[0].sessionId, sessions[2].sessionId]),
          )
        yield* database.db
          .update(Database.Schema.environment)
          .set({ keep_alive_until: null })
          .where(inArray(Database.Schema.environment.id, machines.slice(0, 2)))
        yield* subject.environments.cleanup
        expect({
          destroyed: yield* Ref.get(subject.probe.destroyed),
          kept: (yield* environmentsOf(template)).map((row) => row.environmentId).toSorted(),
          unbound: (yield* bindingOf(sessions[0])).environmentId,
        }).toEqual({ destroyed: machines.slice(0, 1), kept: machines.slice(1).toSorted(), unbound: null })
      }),
  )

  it.live(
    "a shutdown destroys every hand machine of its space, also a held and awake one; the chats keep their bindings and get new machines",
    () =>
      Effect.gen(function* () {
        const subject = yield* environmentsWith()
        const organizationId = yield* Seed.organization()
        const template = yield* Seed.environmentTemplate(organizationId, { sessionsPerEnvironment: 1 })
        const spaceId = yield* Seed.team(organizationId)
        const other = yield* Seed.space(organizationId)
        const sessions = yield* Effect.all([
          Seed.subject(organizationId, spaceId),
          Seed.subject(organizationId, spaceId),
          Seed.subject(organizationId, other),
        ])
        yield* Effect.forEach(sessions, (session) =>
          subject.environments
            .bind(session, Seed.version(template))
            .pipe(Effect.andThen(subject.environments.access(session, Option.none()))),
        )
        const machines = yield* Ref.get(subject.probe.provisions)
        const problems = yield* subject.environments.shutdown(spaceId)
        yield* subject.environments.access(sessions[0], Option.none())
        expect({
          problems,
          destroyed: (yield* Ref.get(subject.probe.destroyed)).toSorted(),
          made: (yield* Ref.get(subject.probe.provisions)).length,
        }).toEqual({ problems: [], destroyed: machines.slice(0, 2).toSorted(), made: 4 })
      }),
  )

  it.live("a chat that takes a place on a machine while the cleanup waits for its template keeps the machine", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const sql = yield* SqlClient.SqlClient
      const subject = yield* environmentsWith()
      const organizationId = yield* Seed.organization()
      const template = yield* Seed.environmentTemplate(organizationId)
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, Seed.version(template))
      yield* subject.environments.access(session, Option.none())
      yield* database.db
        .update(Database.Schema.session_environment)
        .set({ reserved_until: new Date(Date.now() - 1000) })
        .where(eq(Database.Schema.session_environment.session_id, session.sessionId))
      yield* database.db.update(Database.Schema.environment).set({ keep_alive_until: null })
      const locked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const taking = yield* sql
        .withTransaction(
          sql`select id from environment_template where id = ${template} for update`.pipe(
            Effect.andThen(Deferred.succeed(locked, undefined)),
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(
              sql`update session_environment set reserved_until = now() + interval '3 days' where session_id = ${session.sessionId}`,
            ),
          ),
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(locked)
      const cleaning = yield* subject.environments.cleanup.pipe(Effect.forkChild)
      yield* sql<{ readonly waiting: number }>`
        select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `.pipe(Effect.repeat({ until: (rows) => (rows.at(0)?.waiting ?? 0) >= 1, schedule: Schedule.spaced("5 millis") }))
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(taking)
      yield* Fiber.join(cleaning)
      expect([yield* Ref.get(subject.probe.destroyed), (yield* environmentsOf(template)).length]).toEqual([[], 1])
    }),
  )

  it.live("a configured token lifetime is the access's lifetime", () =>
    Effect.gen(function* () {
      const subject = yield* environmentsWith({ ENVIRONMENT_TOKEN_LIFETIME: "20 seconds" })
      const organizationId = yield* Seed.organization()
      const session = yield* subjectIn(organizationId)
      yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
      const before = Date.now()
      const access = yield* subject.environments.access(session, Option.none())
      const after = Date.now()
      expect(DateTime.toEpochMillis(access.expiresAt) - after).toBeLessThanOrEqual(20_000)
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
      yield* Effect.forEach(
        sessions,
        (session) => subject.environments.bind(session, Seed.version(environmentTemplateId)),
        {
          discard: true,
        },
      )
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
        yield* Effect.forEach(
          [shared, other],
          (session) => subject.environments.bind(session, Seed.version(environmentTemplateId)),
          {
            discard: true,
          },
        )
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
        yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
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
        yield* Effect.forEach(
          sessions,
          (session) => subject.environments.bind(session, Seed.version(environmentTemplateId)),
          {
            discard: true,
          },
        )
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
        yield* subject.environments.bind(session, Seed.version(yield* Seed.environmentTemplate(organizationId)))
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
        yield* subject.environments.bind(session, Seed.version(environmentTemplateId))
        yield* database.db
          .update(Database.Schema.environment_template)
          .set({ archived_at: new Date() })
          .where(eq(Database.Schema.environment_template.id, environmentTemplateId))
        expect((yield* subject.environments.access(session, Option.none()).pipe(Effect.flip))._tag).toBe(
          "Environments.NotFound",
        )
        const elsewhere = yield* Seed.environmentTemplate(organizationId, { provider: "e2b" })
        expect(
          (yield* subject.environments
            .bind(yield* subjectIn(organizationId), Seed.version(elsewhere))
            .pipe(Effect.flip))._tag,
        ).toBe("Environments.NotFound")
      }),
  )
})

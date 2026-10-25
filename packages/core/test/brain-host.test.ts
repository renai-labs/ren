import { describe, expect, setDefaultTimeout } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { StartBody } from "@ren/host-api/brain-api"
import { BrainToken } from "@ren/host-api/brain-token"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import { Signature } from "@ren/schema/signature"
import { eq, sql } from "drizzle-orm"
import { Clock, ConfigProvider, Context, Duration, Effect, Fiber, Layer, Option, Queue, Redacted, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { Access } from "../src/access.js"
import { App } from "../src/app.js"
import { BrainClient } from "../src/brain-client.js"
import { Brains } from "../src/brains.js"
import { Credentials } from "../src/credentials.js"
import { EgressControl } from "../src/egress-control.js"
import { Envelope } from "../src/envelope.js"
import { OAuthFetch } from "../src/oauth-fetch.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Models } from "../src/models.js"
import { AppProfiles } from "../src/app/profiles.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"
import { Signer } from "../src/signer.js"

setDefaultTimeout(60_000)

const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, stub.url)

const source: { available: boolean } = { available: true }

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    inference: Shared.inference(),
    revision: Effect.succeed("test"),
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () =>
      source.available
        ? Effect.succeed(configured)
        : Effect.fail(new Models.Unavailable({ cause: new Error("the model source is down") })),
  }),
)

const it = testEffect(Testing.layer)

const publicKeys = Host.keys.map((key) => key.publicKey)

const claims = (token: string) =>
  BrainToken.verify(publicKeys, token).pipe(
    Effect.flatMap((found) =>
      Option.isSome(found) ? Effect.succeed(found.value) : Effect.die(new Error("an invalid token")),
    ),
  )

const sendTo = (
  sessionId: Session.ID,
  text: string,
  messageId = Session.MessageID.create(),
  files?: ReadonlyArray<Session.File>,
) =>
  Brains.Service.use((brain) =>
    brain.send({
      sessionId,
      messageId,
      prompt: { text, ...(files && { files }) },
      delivery: "steer",
      sender: { userId: "user_1" },
    }),
  )

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )

const closedPort = Effect.promise(async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const url = server.url.origin
  await server.stop(true)
  return url
})

const cell = (url: string, config: Record<string, string> = {}) =>
  Host.cellLayer({ CELL_URL: url, ...config }, fixed, Host.noTemplates)

const seeded = Effect.gen(function* () {
  const owner = yield* Seed.owner()
  const sessionId = yield* Seed.session(owner)
  return { owner, sessionId }
})

describe("BrainHost calls to a brain", () => {
  it.live("a send of a session that the brain has not started fails with SessionNotStartedError", () =>
    Effect.gen(function* () {
      const answering = yield* serve(() =>
        Response.json({ _tag: "SessionNotStartedError", message: "not started" }, { status: 409 }),
      )
      const subject = yield* seeded
      const failure = yield* sendTo(subject.sessionId, "too early").pipe(
        Effect.flip,
        Effect.provide(cell(answering.url.origin)),
      )
      expect(failure._tag).toBe("SessionNotStartedError")
    }),
  )

  it.live("file limits are checked before the call, and the brain's body-size refusal is not retried", () =>
    Effect.gen(function* () {
      const requests: Array<string> = []
      const refusing = yield* serve((request) => {
        requests.push(new URL(request.url).pathname)
        return new Response(null, { status: 413 })
      })
      const subject = yield* seeded
      const file = (bytes: number) => [{ url: `data:text/plain,${"a".repeat(bytes)}`, name: "a.png" }]
      const failures = yield* Effect.all([
        sendTo(subject.sessionId, "look", Session.MessageID.create(), file(3000)).pipe(Effect.flip),
        sendTo(subject.sessionId, "look", Session.MessageID.create(), file(3001)).pipe(Effect.flip),
        sendTo(subject.sessionId, "look", Session.MessageID.create(), [
          { url: `data:text/plain,${"a".repeat(6_000_000)}` },
          { url: `data:text/plain,${"b".repeat(6_000_000)}` },
        ]).pipe(Effect.flip),
      ]).pipe(Effect.provide(cell(refusing.url.origin, { BRAIN_MAX_FILE_SIZE: "8MB" })))
      expect(failures).toMatchObject([
        { _tag: "BrainRejectedError", message: "The host rejected the request because its body is too large" },
        { _tag: "BrainRejectedError", message: "The host rejected the request because its body is too large" },
        { _tag: "BrainRejectedError", message: "A message’s files total more than 10 MB" },
      ])
      const small = yield* sendTo(subject.sessionId, "look", Session.MessageID.create(), file(3001)).pipe(
        Effect.flip,
        Effect.provide(cell(refusing.url.origin, { BRAIN_MAX_FILE_SIZE: "3kB" })),
      )
      expect(small).toMatchObject({ _tag: "BrainRejectedError", message: "a.png is larger than 3 kB" })
      expect(requests).toEqual([
        `/ren/sessions/${subject.sessionId}/messages`,
        `/ren/sessions/${subject.sessionId}/messages`,
      ])
    }),
  )

  it.effect("a brain that never answers fails a send with BrainUnavailable at the time limit", () =>
    Effect.gen(function* () {
      const reached = Promise.withResolvers<void>()
      const silent = yield* serve(() => {
        reached.resolve()
        return new Promise<Response>(() => {})
      })
      const subject = yield* seeded
      const pending = yield* sendTo(subject.sessionId, "hello").pipe(
        Effect.flip,
        Effect.provide(cell(silent.url.origin)),
        Effect.forkChild,
      )
      yield* Effect.promise(() => reached.promise)
      yield* TestClock.adjust("29 seconds")
      expect(pending.pollUnsafe()).toBeUndefined()
      yield* TestClock.adjust("1 second")
      expect((yield* Fiber.join(pending))._tag).toBe("BrainUnavailable")
    }),
  )

  it.effect("a send retries a transient answer or a refused connection 4 times, then fails with BrainUnavailable", () =>
    Effect.gen(function* () {
      const requests: Array<string> = []
      const busy = yield* serve((request) => {
        requests.push(new URL(request.url).pathname)
        return new Response("busy", { status: 503 })
      })
      const subject = yield* seeded
      const outcomes = yield* Effect.forEach([busy.url.origin, yield* closedPort], (url) =>
        Effect.gen(function* () {
          const sleeps = yield* Queue.unbounded<number>()
          const clock = yield* TestClock.testClockWith((testClock) =>
            Effect.succeed<Clock.Clock>({
              ...testClock,
              sleep: (duration) =>
                Queue.offer(sleeps, Duration.toMillis(duration)).pipe(Effect.andThen(testClock.sleep(duration))),
            }),
          )
          const pending = yield* sendTo(subject.sessionId, "hello").pipe(
            Effect.flip,
            Effect.provide(cell(url)),
            Effect.provideService(Clock.Clock, clock),
            Effect.forkChild,
          )
          const backoff: Array<number> = []
          yield* Queue.take(sleeps).pipe(
            Effect.flatMap((millis) =>
              millis < Duration.toMillis("30 seconds")
                ? Effect.sync(() => backoff.push(millis)).pipe(Effect.andThen(TestClock.adjust(millis)))
                : Effect.void,
            ),
            Effect.repeat({ until: () => backoff.length === 4 }),
          )
          return { failure: (yield* Fiber.join(pending))._tag, backoff }
        }),
      )
      expect(outcomes).toEqual(
        Array.from({ length: 2 }, () => ({ failure: "BrainUnavailable", backoff: [500, 1000, 2000, 4000] })),
      )
      expect(requests).toHaveLength(5)
    }),
  )
})

describe("BrainHost pull", () => {
  it.live("every pull sends the full catalog, also to a brain that sends the fingerprint it has (HR9)", () =>
    Effect.gen(function* () {
      const subject = yield* seeded
      const actor = { userId: subject.owner.createdBy, organizationId: subject.owner.organizationId, roles: ["owner"] }
      const host = {
        brainId: Brain.ofSession(subject.sessionId),
        organizationId: actor.organizationId,
        spaceId: subject.owner.spaceId,
        generation: 1,
      }
      const apps = yield* App.Service
      const profiles = yield* AppProfiles.Service
      const database = yield* Database.Service
      yield* database.db.insert(Database.Schema.space_member).values({
        id: Space.MembershipID.create(),
        space_id: subject.owner.spaceId,
        user_id: actor.userId,
      })
      const app = yield* apps.create(actor, Seed.appInput(yield* Seed.space(actor.organizationId), "notes"))
      const use = yield* profiles.create(actor, {
        appId: app.id,
        name: "Listed",
        slug: "listed",
        kind: "shared",
        spaceIds: [subject.owner.spaceId],
      })
      const brain = yield* Brains.Service
      const request = { version: "test", keyIds: [], sessions: [] }
      const first = (yield* brain.pull(host, request)).apps
      if (!first) return yield* Effect.die(new Error("The first pull has no catalog"))
      expect(first.catalog.apps.map((entry) => entry.appId)).toEqual([app.id])
      const legacy = { ...request, models: "models-1", layers: { agents: {} }, apps: first.fingerprint, env: "env-1" }
      expect((yield* brain.pull(host, legacy)).apps).toEqual(first)
      yield* profiles.delete(actor, use.id)
      const removed = yield* brain.pull(host, legacy)
      expect(removed.apps?.fingerprint).not.toBe(first.fingerprint)
      expect(removed.apps?.catalog.apps).toEqual([])
    }).pipe(
      Effect.provide(
        Layer.mergeAll(App.layer, AppProfiles.layer, cell("http://127.0.0.1:9")).pipe(
          Layer.provideMerge(Credentials.layer),
          Layer.provideMerge(
            Layer.mergeAll(Access.layer, Envelope.layerLocal, OAuthFetch.layerUnchecked, EgressControl.layerNone),
          ),
        ),
      ),
    ),
  )

  it.live("a catalog whose space is archived is omitted while the rest of pull still succeeds", () =>
    Effect.gen(function* () {
      const subject = yield* seeded
      const database = yield* Database.Service
      const brain = yield* Brains.Service
      const host = {
        brainId: Brain.ofSession(subject.sessionId),
        organizationId: subject.owner.organizationId,
        spaceId: subject.owner.spaceId,
        generation: 1,
      }
      const request = { version: "test", keyIds: [], sessions: [] }
      const initial = yield* brain.pull(host, request)
      if (!initial.apps) return yield* Effect.die(new Error("The first pull has no catalog"))
      yield* database.db
        .update(Database.Schema.space)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.space.id, subject.owner.spaceId))
      const reply = yield* brain.pull(host, request)
      expect(reply).not.toHaveProperty("apps")
      expect(reply.chats.map((chat) => chat.id)).toContain(subject.sessionId)
    }).pipe(Effect.provide(cell("http://127.0.0.1:9"))),
  )

  it.live("an app catalog that cannot be read is omitted while the rest of pull still succeeds", () =>
    Effect.gen(function* () {
      const subject = yield* seeded
      const database = yield* Database.Service
      const brain = yield* Brains.Service
      const host = {
        brainId: Brain.ofSession(subject.sessionId),
        organizationId: subject.owner.organizationId,
        spaceId: subject.owner.spaceId,
        generation: 1,
      }
      yield* Effect.acquireRelease(
        database.db.execute(sql`alter table app_profile rename to app_profile_unreadable`),
        () => database.db.execute(sql`alter table app_profile_unreadable rename to app_profile`).pipe(Effect.orDie),
      )
      const reply = yield* brain.pull(host, { version: "test", keyIds: [], sessions: [] })
      expect(reply).not.toHaveProperty("apps")
      expect(reply.chats.map((chat) => chat.id)).toContain(subject.sessionId)
    }).pipe(Effect.provide(cell("http://127.0.0.1:9"))),
  )

  it.live("a pull sends the inference URL and no model keys, behind the egress or not (HR3, HR16)", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const replyOf = Effect.fnUntraced(function* (egress: boolean) {
        const subject = yield* seeded
        const brainId = (yield* database.db
          .select({ brainId: Database.Schema.agent_session.brain_id })
          .from(Database.Schema.agent_session)
          .where(eq(Database.Schema.agent_session.id, subject.sessionId))).at(0)?.brainId
        if (!brainId) return yield* Effect.die(new Error("the session has no brain"))
        yield* database.db.update(Database.Schema.brain).set({ egress }).where(eq(Database.Schema.brain.id, brainId))
        const reply = yield* Brains.Service.use((brain) =>
          brain.pull(
            { brainId, organizationId: subject.owner.organizationId, spaceId: subject.owner.spaceId, generation: 1 },
            { version: "test", keyIds: [], sessions: [] },
          ),
        ).pipe(Effect.provide(cell("http://127.0.0.1:9")))
        return reply.inference
      })
      const expected = { baseUrl: Shared.stub().root }
      expect([yield* replyOf(true), yield* replyOf(false)]).toEqual([expected, expected])
    }),
  )

  it.live("a pull that lists a root chat Ren no longer has gets it back as deleted", () =>
    Effect.gen(function* () {
      const subject = yield* seeded
      const database = yield* Database.Service
      const brainId = (yield* database.db
        .select({ brainId: Database.Schema.agent_session.brain_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, subject.sessionId))).at(0)?.brainId
      if (!brainId) return yield* Effect.die(new Error("the session has no brain"))
      const gone = Session.ID.create()
      const reply = yield* Brains.Service.use((brain) =>
        brain.pull(
          { brainId, organizationId: subject.owner.organizationId, spaceId: subject.owner.spaceId, generation: 1 },
          {
            version: "test",
            keyIds: [],
            sessions: [],
            roots: [subject.sessionId, gone],
          },
        ),
      ).pipe(Effect.provide(cell("http://127.0.0.1:9")))
      expect(reply.deleted).toEqual([gone])
    }),
  )
})

describe("BrainHost host tokens", () => {
  it.effect("a host call checks the token's kind, brain and generation, and a refreshed token lasts two hours", () =>
    Effect.gen(function* () {
      const subject = yield* seeded
      const database = yield* Database.Service
      const brainId = (yield* database.db
        .select({ brainId: Database.Schema.agent_session.brain_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, subject.sessionId))).at(0)?.brainId
      if (!brainId) return yield* Effect.die(new Error("the session has no brain"))
      const key = Host.keys[0].privateKey
      const sign = (claimsOf: Parameters<typeof BrainToken.sign>[1]) =>
        BrainToken.sign(key, claimsOf).pipe(Effect.map(Redacted.make))
      const outcomes = yield* Effect.gen(function* () {
        const brain = yield* Brains.Service
        const server = yield* sign({ scope: "server", brain: brainId, gen: 1, exp: 600 })
        const old = yield* sign({
          scope: "host",
          brain: brainId,
          gen: 0,
          org: subject.owner.organizationId,
          iat: 0,
          exp: 600,
        })
        const other = yield* sign({
          scope: "host",
          brain: brainId,
          gen: 1,
          org: Auth.OrganizationID.create(),
          iat: 0,
          exp: 600,
        })
        const valid = yield* sign({
          scope: "host",
          brain: brainId,
          gen: 1,
          org: subject.owner.organizationId,
          iat: 0,
          exp: 600,
        })
        const failures = yield* Effect.forEach([server, other, old], (token) =>
          brain.authenticateHost(token).pipe(
            Effect.flip,
            Effect.map((error) => error._tag),
          ),
        )
        const host = yield* brain.authenticateHost(valid)
        const refreshed = yield* claims(Redacted.value((yield* brain.refreshHostToken(host)).hostToken))
        return { failures, host, exp: refreshed.exp }
      }).pipe(Effect.provide(cell("http://127.0.0.1:9")))
      expect(outcomes).toEqual({
        failures: ["UnauthorizedError", "ForbiddenError", "GenerationRetiredError"],
        host: { brainId, organizationId: subject.owner.organizationId, spaceId: subject.owner.spaceId, generation: 1 },
        exp: Duration.toSeconds("2 hours"),
      })
    }),
  )

  it.live("tokens for a brain are signed with the newest key that brain holds", () =>
    Effect.gen(function* () {
      const newer = yield* Signature.generate("newer")
      const older = Host.keys[0].privateKey
      const keys = JSON.stringify(
        [newer.privateKey, older].map((key) => ({
          id: key.id,
          key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(key.key),
        })),
      )
      const signedWith = (keyIds: ReadonlyArray<string>) =>
        BrainClient.Service.use((client) =>
          client.clientToken(
            {
              brainId: Brain.ID.create(),
              generation: 1,
              organizationId: Auth.OrganizationID.create(),
              url: "http://127.0.0.1:9",
              keyIds,
              egress: false,
            },
            { sid: Session.ID.create(), sub: Auth.UserID.create(), member: Auth.MemberID.create() },
          ),
        ).pipe(
          Effect.map((signed) => BrainToken.keyIdOf(signed.token)),
          Effect.provide(BrainClient.layer.pipe(Layer.provide(Signer.layerLocal))),
          Effect.provide(FetchHttpClient.layer),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ BRAIN_KEYS: keys }))),
        )
      expect([yield* signedWith([older.id]), yield* signedWith([older.id, newer.privateKey.id])]).toEqual([
        Option.some(older.id),
        Option.some(newer.privateKey.id),
      ])
    }),
  )
})

describe("BrainHost environments", () => {
  const recordingCell = Effect.fnUntraced(function* (status = 200) {
    const starts: Array<StartBody> = []
    const server = yield* serve(async (request) => {
      const payload = Schema.decodeUnknownSync(StartBody)(await request.json())
      starts.push(payload)
      return status === 200
        ? Response.json({ sessionId: payload.sessionId, harness: "opencode" })
        : Response.json({ _tag: "BrainRejectedError", message: "the cell refused" }, { status })
    })
    return { starts, url: server.url.origin }
  })
  const hostWith = Effect.fnUntraced(function* (cellUrl: string) {
    const keys = yield* Signature.generate("env")
    const probe = yield* TestProvider.make()
    const context = yield* Layer.build(
      Host.cellLayer(
        { CELL_URL: cellUrl },
        fixed,
        Layer.fresh(Environments.layer.pipe(Layer.provide(Signer.layerLocal))).pipe(
          Layer.provide(EnvironmentProvider.layer([Effect.succeed(probe.provider)])),
          Layer.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                ENVIRONMENT_KEYS: JSON.stringify([
                  {
                    id: keys.privateKey.id,
                    key: Schema.encodeSync(Schema.Uint8ArrayFromBase64Url)(keys.privateKey.key),
                  },
                ]),
              }),
            ),
          ),
        ),
      ),
    )
    return context
  })
  const startOn = (
    context: Effect.Success<ReturnType<typeof hostWith>>,
    subject: Effect.Success<typeof seeded>,
    id: EnvironmentTemplate.ID | undefined,
  ) =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const brainId = (yield* database.db
        .select({ brainId: Database.Schema.agent_session.brain_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, subject.sessionId))).at(0)?.brainId
      if (!brainId) return yield* Effect.die(new Error("the session has no brain"))
      const input = {
        sessionId: subject.sessionId,
        harness: "opencode",
        interactive: true,
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: "hello" },
          sender: { userId: subject.owner.createdBy },
        },
        ...(id && { environmentTemplateId: id }),
      } satisfies Session.StartInput
      const placement = { organizationId: subject.owner.organizationId, spaceId: subject.owner.spaceId, brainId }
      yield* Context.get(context, Brains.Service).start(input, placement)
      yield* Brains.StartRun.execute({ input, placement, epoch: 0 }).pipe(Effect.provideContext(context))
    })

  it.live("a start gives the brain the chat's environment directory, also on a later start that names none", () =>
    Effect.gen(function* () {
      const recording = yield* recordingCell()
      const host = yield* hostWith(recording.url)
      const subject = yield* seeded
      const environmentTemplateId = yield* Seed.environmentTemplate(subject.owner.organizationId)
      yield* startOn(host, subject, environmentTemplateId)
      yield* startOn(host, subject, undefined)
      expect(recording.starts.map((input) => input.directory)).toEqual([
        `/workspace/${subject.sessionId}`,
        `/workspace/${subject.sessionId}`,
      ])
    }),
  )

  it.live("Ren refuses an unknown environment template, or a change of template, before it calls the brain", () =>
    Effect.gen(function* () {
      const recording = yield* recordingCell()
      const host = yield* hostWith(recording.url)
      const subject = yield* seeded
      yield* startOn(host, subject, EnvironmentTemplate.ID.create())
      expect(recording.starts).toEqual([])
      yield* startOn(host, subject, yield* Seed.environmentTemplate(subject.owner.organizationId))
      yield* startOn(host, subject, yield* Seed.environmentTemplate(subject.owner.organizationId))
      expect(recording.starts).toHaveLength(1)
    }),
  )

  it.live("two starts at once that name different templates leave the chat on one", () =>
    Effect.gen(function* () {
      const recording = yield* recordingCell()
      const host = yield* hostWith(recording.url)
      const subject = yield* seeded
      const templates = [
        yield* Seed.environmentTemplate(subject.owner.organizationId),
        yield* Seed.environmentTemplate(subject.owner.organizationId),
      ]
      yield* Effect.forEach(templates, (id) => startOn(host, subject, id), { concurrency: "unbounded" })
      expect(recording.starts).toHaveLength(1)
    }),
  )

  it.live("a start that the brain refuses removes the binding that it made", () =>
    Effect.gen(function* () {
      const recording = yield* recordingCell(422)
      const host = yield* hostWith(recording.url)
      const subject = yield* seeded
      yield* startOn(host, subject, yield* Seed.environmentTemplate(subject.owner.organizationId))
      expect(recording.starts).toHaveLength(1)
      const database = yield* Database.Service
      expect(
        yield* database.db
          .select()
          .from(Database.Schema.session_environment)
          .where(eq(Database.Schema.session_environment.session_id, subject.sessionId)),
      ).toEqual([])
    }),
  )
})

import { afterAll, beforeAll, describe, expect } from "bun:test"
import { Shared, TestToken } from "@ren/cell/testing"
import { StartBody } from "@ren/host-api/brain-api"
import { SessionToken } from "@ren/host-api/session-token"
import { Signature } from "@ren/environment-api/signature"
import { Testing } from "@ren/db/testing"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import { Space } from "@ren/schema/space"
import {
  Cause,
  Clock,
  ConfigProvider,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Queue,
  Redacted,
  Ref,
  Result,
  Schema,
} from "effect"
import { Base64Url } from "effect/encoding"
import { TestClock } from "effect/testing"
import { BrainHost } from "../src/brain-host.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { Environments } from "../src/environments.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

const runtime = ManagedRuntime.make(Shared.layer)
beforeAll(async () => {
  settings.CELL_URL = (await runtime.runPromise(Shared.Service)).url
}, 120_000)
afterAll(() => runtime.dispose())
const stub = Shared.stub()

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") })

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
    refreshIfDue: () => Effect.succeedNone,
    revoke: () => Effect.void,
  }),
)

const host = (config: Record<string, string>, models: Layer.Layer<Models.Service> = fixed) => Host.layer(config, models)

const settings = {
  CELL_URL: "",
  CELL_KEYS: TestToken.vars.CELL_KEYS,
}
const organizationId = Auth.OrganizationID.create()
const unknownKey = { id: "unknown", secret: "a-key-the-cell-does-not-list-at-all" }

const it = testEffect(Layer.unwrap(Effect.sync(() => host(settings))))

const start = Effect.fnUntraced(function* (sessionId: Session.ID, input: Partial<Session.StartInput> = {}) {
  const brain = yield* BrainHost.Service
  return yield* brain.start(
    { sessionId, harness: "opencode", interactive: true, ...input },
    { organizationId, spaceId: Space.ID.create() },
  )
})

const send = Effect.fnUntraced(function* (
  sessionId: Session.ID,
  text: string,
  messageId = Session.MessageID.create(),
  files?: ReadonlyArray<Session.File>,
) {
  const brain = yield* BrainHost.Service
  return yield* brain.send(
    {
      sessionId,
      messageId,
      prompt: { text, ...(files && { files }) },
      delivery: "steer",
      sender: { userId: "user_1" },
    },
    organizationId,
  )
})

const surface = (access: Session.ClientAccess, path: string, method = "GET") =>
  Effect.promise(() =>
    fetch(`${access.url}${path}`, { method, headers: { authorization: TestToken.basic(access.token) } }),
  )

const claims = (token: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(SessionToken.Claims))(
    Result.getOrThrow(Base64Url.decodeString(token.slice(0, token.indexOf(".")))),
  )

const serve = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true)),
  )

const tooLarge = Effect.fnUntraced(function* () {
  const requests: Array<string> = []
  const server = yield* serve((request) => {
    requests.push(new URL(request.url).pathname)
    return new Response(null, { status: 413 })
  })
  return { requests, url: server.url.origin }
})

const closedPort = Effect.promise(async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const url = server.url.origin
  await server.stop(true)
  return url
})

describe("BrainHost", () => {
  describe("start", () => {
    it.live("starts a session and accepts its initial message in the same call", () =>
      Effect.gen(function* () {
        const sessionId = Session.ID.create()
        const script = stub.script()
        expect(
          yield* start(sessionId, {
            initialMessage: {
              messageId: Session.MessageID.create(),
              prompt: { text: `initial ${script.marker}` },
              sender: { userId: "user_1" },
            },
          }),
        ).toEqual({ sessionId, harness: "opencode" })
        expect((yield* Effect.promise(() => script.called())).authorization).toBe("Bearer sk-configured")
      }),
    )
  })

  describe("send", () => {
    it.live("answers the message id once the cell accepts it, and the turn reaches the model", () =>
      Effect.gen(function* () {
        const sessionId = Session.ID.create()
        yield* start(sessionId)
        const script = stub.script()
        const messageId = Session.MessageID.create()
        expect(yield* send(sessionId, `hello ${script.marker}`, messageId)).toEqual({ messageId })
        expect((yield* Effect.promise(() => script.called())).text).toContain(script.marker)
      }),
    )

    it.live(
      "a file larger than BRAIN_MAX_FILE_SIZE, decoded, fails with BrainRejectedError before reaching the host",
      () =>
        Effect.gen(function* () {
          const host413 = yield* tooLarge()
          const sessionId = Session.ID.create()
          const file = (bytes: number) => [{ url: `data:text/plain,${"a".repeat(bytes)}`, name: "a.png" }]
          const failures = yield* Effect.all([
            send(sessionId, "look", Session.MessageID.create(), file(3000)).pipe(Effect.flip),
            send(sessionId, "look", Session.MessageID.create(), file(3001)).pipe(Effect.flip),
            start(Session.ID.create(), {
              initialMessage: {
                messageId: Session.MessageID.create(),
                prompt: { text: "initial", files: file(3001) },
                sender: { userId: "user_1" },
              },
            }).pipe(Effect.flip),
          ]).pipe(Effect.provide(host({ ...settings, CELL_URL: host413.url, BRAIN_MAX_FILE_SIZE: "3kB" })))
          expect(failures).toMatchObject([
            { _tag: "BrainRejectedError", message: "The host rejected the request because its body is too large" },
            { _tag: "BrainRejectedError", message: "a.png is larger than 3 kB" },
            { _tag: "BrainRejectedError", message: "a.png is larger than 3 kB" },
          ])
          expect(host413.requests).toEqual([`/ren/sessions/${sessionId}/messages`])
        }),
    )

    it.live("a send before start fails with SessionNotStartedError", () =>
      Effect.gen(function* () {
        expect((yield* send(Session.ID.create(), "too early").pipe(Effect.flip))._tag).toBe("SessionNotStartedError")
      }),
    )

    it.live(
      "rejects a message whose individually valid files exceed the aggregate limit before contacting the host",
      () =>
        Effect.gen(function* () {
          const failure = yield* send(Session.ID.create(), "look", Session.MessageID.create(), [
            { url: `data:text/plain,${"a".repeat(6_000_000)}` },
            { url: `data:text/plain,${"b".repeat(6_000_000)}` },
          ]).pipe(Effect.flip, Effect.provide(host({ ...settings, CELL_URL: yield* closedPort })))
          expect(failure).toMatchObject({
            _tag: "BrainRejectedError",
            message: "A message’s files total more than 10 MB",
          })
        }),
    )
  })

  describe("model access", () => {
    const scripted = (
      refreshes: Ref.Ref<ReadonlyArray<Models.Access>>,
      granted: Ref.Ref<number>,
      revoked: Ref.Ref<ReadonlyArray<Models.Subject>> = Ref.makeUnsafe<ReadonlyArray<Models.Subject>>([]),
    ) =>
      Layer.succeed(
        Models.Service,
        Models.Service.of({
          catalog: () => Effect.succeed({ endpoints: [] }),
          grant: () =>
            Ref.updateAndGet(granted, (count) => count + 1).pipe(
              Effect.map((count) => Shared.access({ stub: Shared.apiKey(`sk-granted-${count}`) })),
            ),
          refreshIfDue: () =>
            Ref.modify(refreshes, (pending) => [Option.fromNullishOr(pending[0]), pending.slice(1)] as const),
          revoke: (subject) => Ref.update(revoked, (subjects) => [...subjects, subject]),
        }),
      )

    it.live("a fresh brain gets one granted access and keeps it for later calls", () =>
      Effect.gen(function* () {
        const granted = yield* Ref.make(0)
        const sessionId = Session.ID.create()
        const script = stub.script()
        yield* Effect.gen(function* () {
          yield* start(sessionId)
          yield* send(sessionId, `granted ${script.marker}`)
          return yield* Effect.promise(() => script.called())
        }).pipe(Effect.provide(host(settings, scripted(yield* Ref.make<ReadonlyArray<Models.Access>>([]), granted))))
        expect([script.calls[0]?.authorization, yield* Ref.get(granted)]).toEqual(["Bearer sk-granted-1", 1])
      }),
    )

    it.live("a refreshed access reaches the next model call", () =>
      Effect.gen(function* () {
        const refreshes = yield* Ref.make<ReadonlyArray<Models.Access>>([])
        const sessionId = Session.ID.create()
        const first = stub.script()
        const second = stub.script()
        yield* Effect.gen(function* () {
          const brain = yield* BrainHost.Service
          yield* start(sessionId)
          yield* send(sessionId, `first ${first.marker}`)
          yield* Effect.promise(() => first.called())
          yield* surface(yield* brain.access(sessionId), `/api/experimental/session/${sessionId}/wait`, "POST")
          yield* Ref.set(refreshes, [Shared.access({ stub: Shared.apiKey("sk-refreshed") })])
          yield* send(sessionId, `second ${second.marker}`)
          yield* Effect.promise(() => second.called())
        }).pipe(Effect.provide(host(settings, scripted(refreshes, yield* Ref.make(0)))))
        expect([first.calls[0]?.authorization, second.calls[0]?.authorization]).toEqual([
          "Bearer sk-granted-1",
          "Bearer sk-refreshed",
        ])
      }),
    )

    it.live("revoking a brain's models clears the cell and revokes at the source, so a later send grants anew", () =>
      Effect.gen(function* () {
        const granted = yield* Ref.make(0)
        const revoked = yield* Ref.make<ReadonlyArray<Models.Subject>>([])
        const sessionId = Session.ID.create()
        const script = stub.script()
        yield* Effect.gen(function* () {
          const brain = yield* BrainHost.Service
          yield* start(sessionId)
          yield* brain.revokeModels(sessionId, organizationId)
          yield* send(sessionId, `regranted ${script.marker}`)
          yield* Effect.promise(() => script.called())
        }).pipe(
          Effect.provide(host(settings, scripted(yield* Ref.make<ReadonlyArray<Models.Access>>([]), granted, revoked))),
        )
        expect([yield* Ref.get(revoked), yield* Ref.get(granted), script.calls[0]?.authorization]).toEqual([
          [{ sessionId, organizationId }],
          2,
          "Bearer sk-granted-2",
        ])
      }),
    )

    it.live("revoking a brain's models revokes at the source even when the cell refuses to clear them", () =>
      Effect.gen(function* () {
        const host413 = yield* tooLarge()
        const revoked = yield* Ref.make<ReadonlyArray<Models.Subject>>([])
        const sessionId = Session.ID.create()
        const failure = yield* BrainHost.Service.use((brain) => brain.revokeModels(sessionId, organizationId)).pipe(
          Effect.flip,
          Effect.provide(
            host(
              { ...settings, CELL_URL: host413.url },
              scripted(yield* Ref.make<ReadonlyArray<Models.Access>>([]), yield* Ref.make(0), revoked),
            ),
          ),
        )
        expect([failure._tag, yield* Ref.get(revoked)]).toEqual(["BrainRejectedError", [{ sessionId, organizationId }]])
      }),
    )

    it.live("a failed refresh keeps the brain's credentials, and a failed grant is BrainUnavailable", () =>
      Effect.gen(function* () {
        const sessionId = Session.ID.create()
        yield* start(sessionId)
        const unavailable = new Models.Unavailable({ cause: new Error("gateway down") })
        const failing = Layer.succeed(
          Models.Service,
          Models.Service.of({
            catalog: () => Effect.fail(unavailable),
            grant: () => Effect.fail(unavailable),
            refreshIfDue: () => Effect.fail(unavailable),
            revoke: () => Effect.void,
          }),
        )
        const script = stub.script()
        const outcomes = yield* Effect.all([
          send(sessionId, `kept ${script.marker}`),
          start(Session.ID.create()).pipe(Effect.flip),
        ]).pipe(Effect.provide(host(settings, failing)))
        yield* Effect.promise(() => script.called())
        expect([outcomes[1]._tag, script.calls[0]?.authorization]).toEqual(["BrainUnavailable", "Bearer sk-configured"])
      }),
    )
  })

  describe("access", () => {
    it.live("its token reads the started session through the client surface", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        expect(yield* start(sessionId)).toEqual({ sessionId, harness: "opencode" })
        const response = yield* surface(yield* brain.access(sessionId), `/api/session/${sessionId}`)
        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ data: { id: sessionId } })
      }),
    )
  })

  describe("host authentication", () => {
    const expiring = Layer.succeed(
      Models.Service,
      Models.Service.of({
        catalog: () => Effect.succeed({ endpoints: [] }),
        grant: () =>
          Effect.succeed(Shared.access({ stub: Shared.apiKey("sk-expiring", Duration.toMillis("3 hours")) })),
        refreshIfDue: () => Effect.succeedNone,
        revoke: () => Effect.void,
      }),
    )

    it.effect("accepts only host tokens, and a refreshed host token outlives the latest key by two hours", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const key = TestToken.keys[0]
        const sid = Session.ID.create()
        const exp = 600
        const server = yield* SessionToken.sign(key, { sid, scope: "server", exp })
        expect((yield* brain.authenticateHost(Redacted.make(server)).pipe(Effect.flip))._tag).toBe("ForbiddenError")
        const host = yield* brain.authenticateHost(
          Redacted.make(yield* SessionToken.sign(key, { sid, scope: "host", org: organizationId, iat: 0, exp })),
        )
        expect(host).toEqual({ sessionId: sid, organizationId })
        const refreshed = yield* brain.refreshModels(host)
        expect(claims(refreshed.hostToken ? Redacted.value(refreshed.hostToken) : "").exp).toBe(
          Duration.toSeconds("5 hours"),
        )
      }).pipe(Effect.provide(host(settings, expiring))),
    )

    it.effect("each call to a host carries a host token for the session, signed for that call", () =>
      Effect.gen(function* () {
        const tokens: Array<string | null> = []
        const server = yield* serve((request) => {
          tokens.push(request.headers.get("ren-host-token"))
          return new Response(null, { status: 413 })
        })
        const sessionId = Session.ID.create()
        yield* Effect.gen(function* () {
          yield* Effect.flip(start(sessionId))
          yield* TestClock.adjust("10 minutes")
          yield* Effect.flip(send(sessionId, "hello"))
        }).pipe(Effect.provide(host({ ...settings, CELL_URL: server.url.origin })))
        const signed = { kid: TestToken.keys[0].id, sid: sessionId, scope: "host" as const, org: organizationId }
        expect(tokens.map((token) => claims(token ?? ""))).toEqual([
          { ...signed, iat: 0, exp: Duration.toSeconds("2 hours") },
          { ...signed, iat: Duration.toSeconds("10 minutes"), exp: Duration.toSeconds("130 minutes") },
        ])
      }),
    )
  })

  describe("failures", () => {
    it.live("a host body-size rejection is a typed BrainRejectedError and is not retried", () =>
      Effect.gen(function* () {
        const host413 = yield* tooLarge()
        const sessionId = Session.ID.create()
        const failures = yield* Effect.all([
          start(sessionId).pipe(Effect.flip),
          send(sessionId, "hello").pipe(Effect.flip),
        ]).pipe(Effect.provide(host({ ...settings, CELL_URL: host413.url })))
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainRejectedError", "BrainRejectedError"])
        expect(host413.requests).toEqual(["/ren/sessions", `/ren/sessions/${sessionId}/messages`])
      }),
    )

    it.effect("a host that never answers fails start and send with BrainUnavailable at the time limit", () =>
      Effect.gen(function* () {
        const server = yield* serve(() => new Promise<Response>(() => {}))
        const pending = yield* Effect.forkChild(
          Effect.all(
            [start(Session.ID.create()).pipe(Effect.flip), send(Session.ID.create(), "hello").pipe(Effect.flip)],
            {
              concurrency: 2,
            },
          ).pipe(Effect.provide(host({ ...settings, CELL_URL: server.url.origin }))),
        )
        yield* TestClock.adjust("29 seconds")
        expect(pending.pollUnsafe()).toBeUndefined()
        yield* TestClock.adjust("1 second")
        expect((yield* Fiber.join(pending)).map((failure) => failure._tag)).toEqual([
          "BrainUnavailable",
          "BrainUnavailable",
        ])
      }),
    )

    it.effect(
      "start and send retry a transient answer or a refused connection three times, then fail with BrainUnavailable",
      () =>
        Effect.gen(function* () {
          const requests: Array<string> = []
          const busy = yield* serve((request) => {
            requests.push(new URL(request.url).pathname)
            return new Response("busy", { status: 503 })
          })
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
              const sessionId = Session.ID.create()
              const pending = yield* Effect.forkChild(
                Effect.all([start(sessionId).pipe(Effect.flip), send(sessionId, "hello").pipe(Effect.flip)]).pipe(
                  Effect.provide(host({ ...settings, CELL_URL: url })),
                  Effect.provideService(Clock.Clock, clock),
                ),
              )
              const backoff: Array<number> = []
              yield* Queue.take(sleeps).pipe(
                Effect.flatMap((millis) =>
                  millis < Duration.toMillis("30 seconds")
                    ? Effect.sync(() => backoff.push(millis)).pipe(Effect.andThen(TestClock.adjust(millis)))
                    : Effect.void,
                ),
                Effect.repeat({ until: () => backoff.length === 6 }),
              )
              return { failures: (yield* Fiber.join(pending)).map((failure) => failure._tag), backoff }
            }),
          )
          expect(outcomes).toEqual(
            Array.from({ length: 2 }, () => ({
              failures: ["BrainUnavailable", "BrainUnavailable"],
              backoff: [200, 400, 800, 200, 400, 800],
            })),
          )
          expect(requests).toHaveLength(8)
        }),
    )
  })

  describe("config", () => {
    it.live("signs with the first of CELL_KEYS, and a key the host does not know is a defect", () =>
      Effect.gen(function* () {
        const first = yield* start(Session.ID.create()).pipe(
          Effect.exit,
          Effect.provide(host({ ...settings, CELL_KEYS: JSON.stringify([TestToken.keys[1], unknownKey]) })),
        )
        const unknown = yield* Effect.all([
          start(Session.ID.create()).pipe(Effect.exit),
          send(Session.ID.create(), "hello").pipe(Effect.exit),
        ]).pipe(Effect.provide(host({ ...settings, CELL_KEYS: JSON.stringify([unknownKey, TestToken.keys[1]]) })))
        expect([
          Exit.isSuccess(first),
          ...unknown.map(
            (exit: Exit.Exit<unknown, unknown>) =>
              Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause),
          ),
        ]).toEqual([true, true, true])
      }),
    )
  })

  describe("environments", () => {
    const recordingCell = Effect.fnUntraced(function* (status = 200) {
      const starts: Array<StartBody> = []
      const server = yield* serve(async (request) => {
        const url = new URL(request.url)
        if (url.pathname === "/ren/models") return new Response(null, { status: 204 })
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
        Host.layerWith(
          { CELL_URL: cellUrl, CELL_KEYS: settings.CELL_KEYS },
          fixed,
          Layer.fresh(Environments.layer).pipe(
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
      return Context.get(context, BrainHost.Service)
    })
    const environmentIt = testEffect(Testing.layer)
    const startOn = (
      brain: BrainHost.Interface,
      sessionId: Session.ID,
      org: Auth.OrganizationID,
      id: EnvironmentTemplate.ID,
    ) =>
      Effect.flatMap(Seed.team(org), (spaceId) =>
        brain.start(
          {
            sessionId,
            harness: "opencode",
            interactive: true,
            environmentTemplateId: id,
          },
          { organizationId: org, spaceId },
        ),
      )

    environmentIt.live(
      "start gives the cell the session's environment template, also on a later start that names none",
      () =>
        Effect.gen(function* () {
          const cell = yield* recordingCell()
          const brain = yield* hostWith(cell.url)
          const org = yield* Seed.organization()
          const environmentTemplateId = yield* Seed.environmentTemplate(org)
          const sessionId = Session.ID.create()
          yield* startOn(brain, sessionId, org, environmentTemplateId)
          yield* brain.start(
            { sessionId, harness: "opencode", interactive: true },
            { organizationId: org, spaceId: yield* Seed.team(org) },
          )
          expect(cell.starts.map((input) => input.directory)).toEqual([
            `/workspace/${sessionId}`,
            `/workspace/${sessionId}`,
          ])
          const access = yield* brain.accessEnvironment({ sessionId, organizationId: org })
          expect(access.directory).toBe(`/workspace/${sessionId}`)
        }),
    )

    environmentIt.live(
      "Ren refuses an unknown environment template, or a change of environment template, before it calls the cell",
      () =>
        Effect.gen(function* () {
          const cell = yield* recordingCell()
          const brain = yield* hostWith(cell.url)
          const org = yield* Seed.organization()
          const environmentTemplateId = yield* Seed.environmentTemplate(org)
          const sessionId = Session.ID.create()
          const unknown = yield* startOn(brain, sessionId, org, EnvironmentTemplate.ID.create()).pipe(Effect.flip)
          expect(unknown._tag).toBe("BrainRejectedError")
          expect(cell.starts).toEqual([])
          yield* startOn(brain, sessionId, org, environmentTemplateId)
          const changed = yield* startOn(brain, sessionId, org, yield* Seed.environmentTemplate(org)).pipe(Effect.flip)
          expect(changed._tag).toBe("BrainRejectedError")
          expect(cell.starts.length).toBe(1)
        }),
    )

    environmentIt.live("a start that the cell refuses removes the binding that it made", () =>
      Effect.gen(function* () {
        const cell = yield* recordingCell(422)
        const brain = yield* hostWith(cell.url)
        const org = yield* Seed.organization()
        const sessionId = Session.ID.create()
        expect(
          (yield* startOn(brain, sessionId, org, yield* Seed.environmentTemplate(org)).pipe(Effect.flip))._tag,
        ).toBe("BrainRejectedError")
        expect((yield* brain.accessEnvironment({ sessionId, organizationId: org }).pipe(Effect.flip))._tag).toBe(
          "EnvironmentNotFoundError",
        )
      }),
    )

    environmentIt.live("two starts at once naming different environment templates leave the session on one", () =>
      Effect.gen(function* () {
        const cell = yield* recordingCell()
        const brain = yield* hostWith(cell.url)
        const org = yield* Seed.organization()
        const environmentTemplateId = yield* Seed.environmentTemplate(org)
        const other = yield* Seed.environmentTemplate(org)
        const sessionId = Session.ID.create()
        const exits = yield* Effect.all(
          [startOn(brain, sessionId, org, environmentTemplateId), startOn(brain, sessionId, org, other)].map(
            Effect.exit,
          ),
          { concurrency: "unbounded" },
        )
        expect(exits.map(Exit.isSuccess)).toEqual([true, false])
        expect(cell.starts.length).toBe(1)
      }),
    )

    environmentIt.live("a refreshed host token comes from the host token alone and outlives now by two hours", () =>
      Effect.gen(function* () {
        const brain = yield* hostWith("http://127.0.0.1:9")
        const host = { sessionId: Session.ID.create(), organizationId }
        const body = yield* brain.refreshHostToken(host)
        const refreshed = claims(Redacted.value(body.hostToken))
        expect(refreshed).toMatchObject({ sid: host.sessionId, scope: "host", org: organizationId })
        expect(refreshed.exp * 1000 - Date.now()).toBeGreaterThan(Duration.toMillis(Duration.hours(2)) - 5_000)
      }),
    )
  })
})

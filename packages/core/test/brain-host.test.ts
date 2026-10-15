import { afterAll, beforeAll, describe, expect, setDefaultTimeout } from "bun:test"
import { Shared, TestToken } from "@ren/cell/testing"
import { SessionToken } from "@ren/brain-api/session-token"
import { Auth } from "@ren/schema/auth"
import { Session } from "@ren/schema/session"
import {
  Cause,
  ConfigProvider,
  DateTime,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Option,
  Ref,
  Result,
  Schema,
} from "effect"
import { Base64Url } from "effect/encoding"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { BrainHost } from "../src/brain-host.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"

setDefaultTimeout(30_000)

const runtime = ManagedRuntime.make(Shared.layer)
beforeAll(async () => {
  settings.CELL_URL = (await runtime.runPromise(Shared.Service)).url
}, 120_000)
afterAll(() => runtime.dispose())
const stub = Shared.stub()

const host = (
  config: Record<string, string>,
  models: Layer.Layer<Models.Service> = Layer.fresh(Models.layerConfigured).pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
    Layer.orDie,
  ),
) =>
  Layer.fresh(BrainHost.layer).pipe(
    Layer.provide(models),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

const settings = {
  CELL_URL: "",
  CELL_KEYS: TestToken.vars.CELL_KEYS,
  MODEL_ENDPOINTS: JSON.stringify(
    Schema.encodeSync(Schema.toCodecJson(Schema.Array(Models.Endpoint)))(
      Shared.access({ stub: Shared.apiKey("sk-configured") }).endpoints,
    ),
  ),
}
const organizationId = Auth.OrganizationID.create()
const unknownKey = { id: "unknown", secret: "a-key-the-cell-does-not-list-at-all" }

const it = testEffect(Layer.unwrap(Effect.sync(() => host(settings))))

const start = Effect.fnUntraced(function* (sessionId: Session.ID, input: Partial<Session.StartInput> = {}) {
  const brain = yield* BrainHost.Service
  return yield* brain.start(
    { sessionId, harness: "opencode", instructions: {}, interactive: true, ...input },
    organizationId,
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

const closedPort = Effect.promise(async () => {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const url = server.url.origin
  await server.stop(true)
  return url
})

const died = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) && Cause.hasDies(exit.cause) && !Cause.hasFails(exit.cause)

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

    it.live("rejects oversized initial files before contacting or creating a session on the host", () =>
      Effect.gen(function* () {
        const failure = yield* start(Session.ID.create(), {
          initialMessage: {
            messageId: Session.MessageID.create(),
            prompt: { text: "initial", files: [{ url: `data:text/plain,${"a".repeat(3001)}` }] },
            sender: { userId: "user_1" },
          },
        }).pipe(
          Effect.flip,
          Effect.provide(host({ ...settings, CELL_URL: yield* closedPort, BRAIN_MAX_FILE_SIZE: "3kB" })),
        )
        expect(failure).toMatchObject({ _tag: "BrainRejectedError" })
      }),
    )

    it.live("creates the session in a fresh cell and answers its id and harness", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        expect(yield* start(sessionId)).toEqual({ sessionId, harness: "opencode" })
        const response = yield* surface(yield* brain.access(sessionId), `/api/session/${sessionId}`)
        expect({ status: response.status, body: yield* Effect.promise(() => response.json()) }).toMatchObject({
          status: 200,
          body: { data: { id: sessionId } },
        })
      }),
    )

    it.live("a second start with the same id answers the same and leaves one session", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        const first = yield* start(sessionId)
        expect(yield* start(sessionId, { title: "Renamed" })).toEqual(first)
        const response = yield* surface(yield* brain.access(sessionId), "/api/session")
        const listed = Schema.decodeUnknownSync(
          Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) }),
        )(yield* Effect.promise(() => response.json()))
        expect(listed.data.map((session) => session.id)).toEqual([sessionId])
      }),
    )

    it.live("an unknown agent or model fails with BrainRejectedError", () =>
      Effect.gen(function* () {
        const failures = yield* Effect.all([
          start(Session.ID.create(), { agent: "nobody" }).pipe(Effect.flip),
          start(Session.ID.create(), { model: { endpointId: "stub", modelId: "missing" } }).pipe(Effect.flip),
        ])
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainRejectedError", "BrainRejectedError"])
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

    it.live("a repeated message id runs no second turn", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        yield* start(sessionId)
        const script = stub.script({ hold: true })
        const messageId = Session.MessageID.create()
        const first = yield* send(sessionId, `once ${script.marker}`, messageId)
        yield* Effect.promise(() => script.called())
        const second = yield* send(sessionId, `once ${script.marker}`, messageId)
        script.release()
        const waited = yield* surface(
          yield* brain.access(sessionId),
          `/api/experimental/session/${sessionId}/wait`,
          "POST",
        )
        expect(waited.status).toBe(204)
        expect(second).toEqual(first)
        expect(script.calls).toHaveLength(1)
      }),
    )

    it.live(
      "a file larger than BRAIN_MAX_FILE_SIZE, decoded, fails with BrainRejectedError before reaching the host",
      () =>
        Effect.gen(function* () {
          const failures = yield* Effect.forEach(
            [
              `data:image/png;base64,${"A".repeat(4000)}`,
              `data:image/png;base64,${"A".repeat(4002)}==`,
              `data:text/plain,${"a".repeat(3000)}`,
              `data:text/plain,${"a".repeat(3001)}`,
              `data:text/plain,${"界".repeat(1000)}`,
              `data:text/plain,${"界".repeat(1001)}`,
              `data:text/plain,${"%E7%95%8C".repeat(1000)}`,
              `data:text/plain,${"%E7%95%8C".repeat(1001)}`,
            ],
            (url) =>
              send(Session.ID.create(), "look", Session.MessageID.create(), [{ url, name: "a.png" }]).pipe(Effect.flip),
          ).pipe(Effect.provide(host({ ...settings, CELL_URL: yield* closedPort, BRAIN_MAX_FILE_SIZE: "3kB" })))
          expect(failures.map((failure) => failure._tag)).toEqual([
            "BrainUnavailable",
            "BrainRejectedError",
            "BrainUnavailable",
            "BrainRejectedError",
            "BrainUnavailable",
            "BrainRejectedError",
            "BrainUnavailable",
            "BrainRejectedError",
          ])
          expect(failures[1]).toMatchObject({ message: "a.png is larger than 3 kB" })
        }),
    )

    it.live("BRAIN_MAX_FILE_SIZE defaults to 10 MB", () =>
      Effect.gen(function* () {
        const failures = yield* Effect.forEach([10_000_000, 10_000_001], (bytes) =>
          send(Session.ID.create(), "look", Session.MessageID.create(), [
            { url: `data:text/plain,${"a".repeat(bytes)}` },
          ]).pipe(Effect.flip),
        ).pipe(Effect.provide(host({ ...settings, CELL_URL: yield* closedPort })))
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainUnavailable", "BrainRejectedError"])
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

    it.live(
      "revoking a brain's models clears the cell before revoking at the source, and a later send grants anew",
      () =>
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
            Effect.provide(
              host(settings, scripted(yield* Ref.make<ReadonlyArray<Models.Access>>([]), granted, revoked)),
            ),
          )
          expect([yield* Ref.get(revoked), yield* Ref.get(granted), script.calls[0]?.authorization]).toEqual([
            [{ brainId: sessionId, organizationId }],
            2,
            "Bearer sk-granted-2",
          ])
        }),
    )

    it.live("revoking a brain's models revokes at the source even when the cell cannot be reached", () =>
      Effect.gen(function* () {
        const revoked = yield* Ref.make<ReadonlyArray<Models.Subject>>([])
        const sessionId = Session.ID.create()
        const failure = yield* BrainHost.Service.use((brain) => brain.revokeModels(sessionId, organizationId)).pipe(
          Effect.flip,
          Effect.provide(
            host(
              { ...settings, CELL_URL: yield* closedPort },
              scripted(yield* Ref.make<ReadonlyArray<Models.Access>>([]), yield* Ref.make(0), revoked),
            ),
          ),
        )
        expect([failure._tag, yield* Ref.get(revoked)]).toEqual([
          "BrainUnavailable",
          [{ brainId: sessionId, organizationId }],
        ])
      }),
    )

    it.live("the configured layer lists its models without credentials", () =>
      Effect.gen(function* () {
        const models = yield* Models.Service
        expect(yield* models.catalog({ brainId: Session.ID.create(), organizationId })).toEqual({
          endpoints: [
            {
              id: "stub",
              protocol: "openai-chat",
              models: [
                { id: "stub-model", name: "Stub", limit: { context: 100_000, output: 4000 } },
                { id: "stub-other", name: "Stub Other", limit: { context: 100_000, output: 4000 } },
              ],
            },
          ],
        })
      }).pipe(
        Effect.provide(
          Models.layerConfigured.pipe(Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(settings)))),
        ),
      ),
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
    it.live("answers the worker origin, a client token for the session and its expiry one hour out", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        const before = Math.floor(Date.now() / 1000)
        const access = yield* brain.access(sessionId)
        const payload = claims(access.token)
        expect(access.url).toBe(new URL(settings.CELL_URL).origin)
        expect(payload).toMatchObject({ kid: TestToken.keys[0].id, sid: sessionId, scope: "client" })
        expect(payload.exp - before).toBeGreaterThanOrEqual(3600)
        expect(payload.exp - before).toBeLessThanOrEqual(3601)
        expect(DateTime.toEpochMillis(access.expiresAt)).toBe(payload.exp * 1000)
      }),
    )

    it.live("its token reads the started session through the client surface", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        yield* start(sessionId)
        const access = yield* brain.access(sessionId)
        const response = yield* surface(access, `/api/session/${sessionId}`)
        expect(response.status).toBe(200)
        expect(yield* Effect.promise(() => response.json())).toMatchObject({ data: { id: sessionId } })
      }),
    )

    it.live("its token cannot call the Brain API", () =>
      Effect.gen(function* () {
        const brain = yield* BrainHost.Service
        const sessionId = Session.ID.create()
        const response = yield* surface(yield* brain.access(sessionId), "/ren/sessions", "POST")
        expect(response.status).toBe(403)
      }),
    )
  })

  describe("failures", () => {
    it.live("a host body-size rejection is a typed BrainRejectedError and is not retried", () =>
      Effect.gen(function* () {
        const requests: Array<string> = []
        const server = yield* serve((request) => {
          requests.push(new URL(request.url).pathname)
          return new Response(null, { status: 413 })
        })
        const sessionId = Session.ID.create()
        const failures = yield* Effect.all([
          start(sessionId).pipe(Effect.flip),
          send(sessionId, "hello").pipe(Effect.flip),
        ]).pipe(Effect.provide(host({ ...settings, CELL_URL: server.url.origin })))
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainRejectedError", "BrainRejectedError"])
        expect(requests).toEqual(["/ren/sessions", `/ren/sessions/${sessionId}/messages`])
      }),
    )

    it.live("a host that refuses connections fails start and send with BrainUnavailable", () =>
      Effect.gen(function* () {
        const failures = yield* Effect.all([
          start(Session.ID.create()).pipe(Effect.flip),
          send(Session.ID.create(), "nobody home").pipe(Effect.flip),
        ]).pipe(Effect.provide(host({ ...settings, CELL_URL: yield* closedPort })))
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainUnavailable", "BrainUnavailable"])
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

    it.live("start and send retry a transient answer three times", () =>
      Effect.gen(function* () {
        const requests: Array<string> = []
        const server = yield* serve((request) => {
          requests.push(new URL(request.url).pathname)
          return new Response("busy", { status: 503 })
        })
        const sessionId = Session.ID.create()
        const failures = yield* Effect.all([
          start(sessionId).pipe(Effect.flip),
          send(sessionId, "hello").pipe(Effect.flip),
        ]).pipe(Effect.provide(host({ ...settings, CELL_URL: server.url.origin })))
        expect(failures.map((failure) => failure._tag)).toEqual(["BrainUnavailable", "BrainUnavailable"])
        expect(requests).toEqual([
          ...Array.from({ length: 4 }, () => "/ren/sessions"),
          ...Array.from({ length: 4 }, () => `/ren/sessions/${sessionId}/messages`),
        ])
      }),
    )

    it.live("a token signed with a key the host does not know is a defect, not BrainUnavailable", () =>
      Effect.gen(function* () {
        const exits = yield* Effect.all([
          start(Session.ID.create()).pipe(Effect.exit),
          send(Session.ID.create(), "hello").pipe(Effect.exit),
        ]).pipe(Effect.provide(host({ ...settings, CELL_KEYS: JSON.stringify([unknownKey]) })))
        expect(exits.map(died)).toEqual([true, true])
      }),
    )
  })

  describe("config", () => {
    it.live("signs with the first of CELL_KEYS", () =>
      Effect.gen(function* () {
        const first = yield* start(Session.ID.create()).pipe(
          Effect.exit,
          Effect.provide(host({ ...settings, CELL_KEYS: JSON.stringify([TestToken.keys[1], unknownKey]) })),
        )
        const second = yield* start(Session.ID.create()).pipe(
          Effect.exit,
          Effect.provide(host({ ...settings, CELL_KEYS: JSON.stringify([unknownKey, TestToken.keys[1]]) })),
        )
        expect([Exit.isSuccess(first), died(second)]).toEqual([true, true])
      }),
    )

    it.effect("a missing CELL_URL or CELL_KEYS, or a BRAIN_MAX_FILE_SIZE that is not a size, fails the layer", () =>
      Effect.gen(function* () {
        const exits = yield* Effect.forEach(
          [
            { CELL_KEYS: settings.CELL_KEYS },
            { CELL_URL: settings.CELL_URL },
            { ...settings, BRAIN_MAX_FILE_SIZE: "lots" },
            settings,
          ],
          (config) => Effect.exit(Effect.provide(BrainHost.Service.use(Effect.succeed), host(config))),
        )
        expect(exits.map(Exit.isSuccess)).toEqual([false, false, false, true])
      }),
    )
  })
})

import { describe, expect, setDefaultTimeout } from "bun:test"
import { Shared, TestToken } from "@ren/cell/testing"
import { CellToken } from "@ren/schema/cell-token"
import { Session } from "@ren/schema/session"
import { Cause, ConfigProvider, DateTime, Effect, Exit, Fiber, Layer, Result, Schema } from "effect"
import { Base64Url } from "effect/encoding"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { BrainHost } from "../src/brain-host.js"
import { testEffect } from "./lib/effect.js"

setDefaultTimeout(30_000)

const celld = await Shared.celld()
const stub = Shared.stub()

const host = (config: Record<string, string>) =>
  Layer.fresh(BrainHost.layerCelld).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

const settings = { CELL_URL: celld.url, CELL_KEYS: TestToken.vars.CELL_KEYS }
const unknownKey = { id: "unknown", secret: "a-key-the-cell-does-not-list-at-all" }

const it = testEffect(host(settings))

const start = Effect.fnUntraced(function* (sessionId: Session.ID, input: Partial<Session.StartInput> = {}) {
  const brain = yield* BrainHost.Service
  return yield* brain.start({ sessionId, harness: "opencode", context: {}, interactive: true, ...input })
})

const send = Effect.fnUntraced(function* (sessionId: Session.ID, text: string, messageId = Session.MessageID.create()) {
  const brain = yield* BrainHost.Service
  return yield* brain.send({ sessionId, messageId, prompt: { text }, delivery: "steer", sender: { userId: "user_1" } })
})

const surface = (access: Session.ClientAccess, path: string, method = "GET") =>
  Effect.promise(() =>
    fetch(`${access.url}${path}`, { method, headers: { authorization: TestToken.basic(access.token) } }),
  )

const claims = (token: string) =>
  Schema.decodeUnknownSync(Schema.fromJsonString(CellToken.Payload))(
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

describe("BrainHost on celld", () => {
  describe("start", () => {
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
          start(Session.ID.create(), { model: { providerId: "stub", modelId: "missing" } }).pipe(Effect.flip),
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

    it.live("a send before start fails with SessionNotStartedError", () =>
      Effect.gen(function* () {
        expect((yield* send(Session.ID.create(), "too early").pipe(Effect.flip))._tag).toBe("SessionNotStartedError")
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
        expect(access.url).toBe(new URL(celld.url).origin)
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

    it.live("start retries a transient answer and send does not", () =>
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
          `/ren/sessions/${sessionId}/messages`,
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

    it.effect("a missing CELL_URL or CELL_KEYS fails the layer", () =>
      Effect.gen(function* () {
        const exits = yield* Effect.forEach(
          [{ CELL_KEYS: settings.CELL_KEYS }, { CELL_URL: settings.CELL_URL }, settings],
          (config) => Effect.exit(Effect.provide(BrainHost.Service.use(Effect.succeed), host(config))),
        )
        expect(exits.map(Exit.isSuccess)).toEqual([false, false, true])
      }),
    )
  })
})

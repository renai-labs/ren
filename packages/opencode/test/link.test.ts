import { expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { Deferred, Effect, Exit, Layer, Queue, Scope, Stream, SubscriptionRef } from "effect"
import { FetchHttpClient } from "effect/http"
import { TestClock } from "effect/testing"
import { RenAuth } from "../src/auth.js"
import { Link } from "../src/link.js"
import { RenApi } from "../src/ren.js"

interface Opened {
  readonly origin: string
  readonly authorization: string | null
  readonly send: (frame: SessionEvent.Frame) => void
  readonly close: () => void
  readonly cancelled: Deferred.Deferred<void>
}

const connected: SessionEvent.Frame = { id: "evt_connected", created: 1, type: "server.connected", data: {} }

const ready = (url: string, token: string) => ({
  status: "ready",
  url,
  token,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
})

const fake = Effect.fnUntraced(function* (answers: Array<unknown>) {
  const opened = yield* Queue.unbounded<Opened>()
  const asked: Array<{
    readonly request: string
    readonly unreachable: string | null
    readonly authorization: string | null
  }> = []
  const brains: Record<string, "stream" | "refuse"> = {}
  const encoder = new TextEncoder()
  const fetch = (input: string | URL | Request, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init)
    const url = new URL(request.url)
    if (url.origin === "http://ren") {
      asked.push({
        request: `${request.method} ${url.pathname}`,
        unreachable: url.searchParams.get("unreachable"),
        authorization: request.headers.get("authorization"),
      })
      return Promise.resolve(Response.json(answers.shift() ?? { status: "failed", reason: "no answer left" }))
    }
    if (brains[url.origin] === "refuse") return Promise.reject(new TypeError("fetch failed"))
    const cancelled = Deferred.makeUnsafe<void>()
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        Queue.offerUnsafe(opened, {
          origin: url.origin,
          authorization: request.headers.get("authorization"),
          send: (frame) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`)),
          close: () => controller.close(),
          cancelled,
        })
      },
      cancel: () => {
        Deferred.doneUnsafe(cancelled, Exit.void)
      },
    })
    return Promise.resolve(new Response(body, { headers: { "content-type": "text/event-stream" } }))
  }
  const layer = Link.layer.pipe(
    Layer.provide(RenApi.layer),
    Layer.provide(
      Layer.succeed(
        RenAuth.Service,
        RenAuth.Service.of({ server: new URL("http://ren"), token: Effect.succeed("user-token") }),
      ),
    ),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      Layer.succeed(FetchHttpClient.Fetch, Object.assign(fetch, { preconnect: globalThis.fetch.preconnect })),
    ),
  )
  return { opened, asked, brains, links: yield* Layer.build(layer) }
})

const run = <A, E>(body: Effect.Effect<A, E, Scope.Scope>) =>
  body.pipe(Effect.scoped, Effect.provide(TestClock.layer()), Effect.runPromise)

const until = <A>(ref: SubscriptionRef.SubscriptionRef<A>, predicate: (value: A) => boolean) =>
  SubscriptionRef.changes(ref).pipe(Stream.filter(predicate), Stream.runHead)

const follow = Effect.fnUntraced(function* (link: Link.Link) {
  const frames = yield* Queue.unbounded<SessionEvent.Frame>()
  yield* (yield* link.frames).pipe(
    Stream.runForEach((frame) => Queue.offer(frames, frame)),
    Effect.forkScoped,
  )
  return frames
})

const open = (links: Effect.Success<ReturnType<typeof fake>>["links"], sessionId: Session.ID) =>
  Effect.gen(function* () {
    const service = yield* Link.Service
    return yield* service.open(sessionId)
  }).pipe(Effect.provide(links))

test("a link asks Ren for chat access with the user's token, waits while the brain starts, and streams the session's events from the URL Ren gave with Basic auth", () =>
  run(
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const ren = yield* fake([{ status: "starting", phase: "waking" }, ready("http://one", "t1")])
      const link = yield* open(ren.links, sessionId)
      const frames = yield* follow(link)
      yield* until(link.boot, (boot) => boot._tag === "Starting")
      expect(yield* SubscriptionRef.get(link.boot)).toEqual({ _tag: "Starting", phase: "waking" })
      yield* TestClock.adjust("2 seconds")
      const stream = yield* Queue.take(ren.opened)
      expect([stream.origin, stream.authorization]).toEqual(["http://one", `Basic ${btoa("ren:t1")}`])
      const renamed = {
        id: "evt_renamed",
        created: 2,
        type: "session.renamed",
        data: { sessionID: sessionId, title: "Renamed" },
      } as const
      stream.send(connected)
      stream.send(renamed)
      expect([yield* Queue.take(frames), yield* Queue.take(frames)]).toEqual([connected, renamed])
      expect(yield* SubscriptionRef.get(link.boot)).toEqual({ _tag: "Ready" })
      expect(ren.asked).toEqual(
        Array.from({ length: 2 }, () => ({
          request: `POST /sessions/${sessionId}/chat`,
          unreachable: null,
          authorization: "Bearer user-token",
        })),
      )
    }),
  ))

test.each([
  ["failed", { status: "failed", reason: "no capacity" }, { _tag: "Failed", reason: "no capacity" }],
  ["stopped", { status: "stopped" }, { _tag: "Stopped" }],
] as const)("a %s brain shows in the boot state and the link opens no stream", (_name, answer, boot) =>
  run(
    Effect.gen(function* () {
      const ren = yield* fake([answer])
      const link = yield* open(ren.links, Session.ID.create())
      yield* until(link.status, (status) => status === "parked")
      expect(yield* SubscriptionRef.get(link.boot)).toEqual(boot)
      expect(ren.asked).toHaveLength(1)
      expect(yield* Queue.size(ren.opened)).toBe(0)
    }),
  ),
)

test("when the brain's URL takes no connection the link asks Ren again with unreachable, follows the new URL, and its consumers see server.connected again", () =>
  run(
    Effect.gen(function* () {
      const ren = yield* fake([ready("http://one", "t1"), ready("http://one", "t2"), ready("http://two", "t3")])
      const link = yield* open(ren.links, Session.ID.create())
      const frames = yield* follow(link)
      const first = yield* Queue.take(ren.opened)
      first.send(connected)
      expect(yield* Queue.take(frames)).toEqual(connected)
      ren.brains["http://one"] = "refuse"
      first.close()
      yield* until(link.retryAt, (at) => at > 0)
      yield* TestClock.adjust("1 second")
      yield* until(link.retryAt, (at) => at > 1_000)
      yield* TestClock.adjust("2 seconds")
      const second = yield* Queue.take(ren.opened)
      expect([second.origin, second.authorization]).toEqual(["http://two", `Basic ${btoa("ren:t3")}`])
      second.send(connected)
      expect(yield* Queue.take(frames)).toEqual(connected)
      expect(ren.asked.map((request) => request.unreachable)).toEqual([null, null, "true"])
    }),
  ))

test("a consumer that subscribes while the link is connected starts with server.connected, so it reads what it needs as after a reconnect", () =>
  run(
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const ren = yield* fake([ready("http://one", "t1")])
      const link = yield* open(ren.links, sessionId)
      const first = yield* follow(link)
      const stream = yield* Queue.take(ren.opened)
      stream.send(connected)
      expect(yield* Queue.take(first)).toEqual(connected)
      const later = yield* follow(link)
      const renamed = {
        id: "evt_renamed",
        created: 2,
        type: "session.renamed",
        data: { sessionID: sessionId, title: "Renamed" },
      } as const
      stream.send(renamed)
      expect((yield* Queue.take(later)).type).toBe("server.connected")
      expect(yield* Queue.take(later)).toEqual(renamed)
      expect(yield* Queue.take(first)).toEqual(renamed)
    }),
  ))

test("one link serves a session while any scope holds it, and closing the last scope ends its stream", () =>
  run(
    Effect.gen(function* () {
      const sessionId = Session.ID.create()
      const ren = yield* fake([ready("http://one", "t1"), ready("http://one", "t2")])
      const model = yield* Scope.make()
      const mirror = yield* Scope.make()
      const first = yield* open(ren.links, sessionId).pipe(Scope.provide(model))
      const second = yield* open(ren.links, sessionId).pipe(Scope.provide(mirror))
      expect(second).toBe(first)
      const stream = yield* Queue.take(ren.opened)
      stream.send(connected)
      yield* until(first.status, (status) => status === "connected")
      yield* Scope.close(model, Exit.void)
      expect(yield* Deferred.isDone(stream.cancelled)).toBe(false)
      yield* Scope.close(mirror, Exit.void)
      yield* Deferred.await(stream.cancelled)
      const reopened = yield* open(ren.links, sessionId)
      expect(reopened).not.toBe(first)
      yield* Queue.take(ren.opened)
      expect(ren.asked).toHaveLength(2)
    }),
  ))

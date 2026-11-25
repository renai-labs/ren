import { afterAll, expect, setDefaultTimeout, test } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { BrainTest } from "@ren/cell/testing/brain"
import type { SessionEvent } from "@ren/schema/session/event"
import { Effect, Layer, Queue, Stream } from "effect"
import { FetchHttpClient } from "effect/http"
import { RenAuth } from "../src/auth.js"
import { Link } from "../src/link.js"
import { RenApi } from "../src/ren.js"

setDefaultTimeout(60_000)

afterAll(Shared.dispose)

test("a link to a session on a real brain streams server.connected and the session's events", () =>
  Effect.gen(function* () {
    const brain = yield* BrainTest.make()
    yield* brain.start()
    const fetch = (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(String(input), init)
      const url = new URL(request.url)
      if (url.origin === "http://ren")
        return Promise.resolve(
          Response.json({
            status: "ready",
            url: "http://cell",
            token: "a-client-token",
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        )
      return brain.chatFetch(`${url.pathname}${url.search}`, request)
    }
    const links = yield* Layer.build(
      Link.layer.pipe(
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
      ),
    )
    const link = yield* Effect.gen(function* () {
      const service = yield* Link.Service
      return yield* service.open(brain.id)
    }).pipe(Effect.provide(links))
    const frames = yield* Queue.unbounded<SessionEvent.Frame>()
    yield* (yield* link.frames).pipe(
      Stream.runForEach((frame) => Queue.offer(frames, frame)),
      Effect.forkScoped,
    )
    const next = (type: SessionEvent.Frame["type"]): Effect.Effect<SessionEvent.Frame> =>
      Queue.take(frames).pipe(Effect.flatMap((frame) => (frame.type === type ? Effect.succeed(frame) : next(type))))
    expect((yield* next("server.connected")).type).toBe("server.connected")
    yield* brain.driver.rename(brain.id, "Renamed on the brain")
    expect(yield* next("session.renamed")).toMatchObject({
      data: { sessionID: brain.id, title: "Renamed on the brain" },
    })
  }).pipe(Effect.scoped, Effect.runPromise))

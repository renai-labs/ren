import { describe, expect } from "bun:test"
import { Brain } from "@ren/schema/brain"
import { Clock, Duration, Effect, Queue, Schema } from "effect"
import { TestClock } from "effect/testing"
import { Testing } from "@ren/db/testing"
import { Brains } from "../src/brains.js"
import { Configured } from "./lib/configured.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

describe("Brains on the cell host", () => {
  it.effect(
    "a start while the cell answers 503 is delivered once the cell answers, not dropped",
    () =>
      Effect.gen(function* () {
        const gate = { open: false }
        const answers = yield* Queue.unbounded<number>()
        const cell = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.serve({
              hostname: "127.0.0.1",
              port: 0,
              fetch: async (request) => {
                const status = gate.open ? 200 : 503
                Queue.offerUnsafe(answers, status)
                if (!gate.open) return new Response("busy", { status })
                const body = Schema.decodeUnknownSync(Schema.Struct({ sessionId: Schema.String }))(await request.json())
                return Response.json({ sessionId: body.sessionId, harness: "opencode" })
              },
            }),
          ),
          (server) => Effect.promise(() => server.stop(true)),
        )
        const sleeps = yield* Queue.unbounded<number>()
        const clock = yield* TestClock.testClockWith((testClock) =>
          Effect.succeed<Clock.Clock>({
            ...testClock,
            sleep: (duration) =>
              Queue.offer(sleeps, Duration.toMillis(duration)).pipe(Effect.andThen(testClock.sleep(duration))),
          }),
        )
        yield* Queue.take(sleeps).pipe(
          Effect.flatMap((millis) =>
            millis < Duration.toMillis("30 seconds") ? TestClock.adjust(millis) : Effect.void,
          ),
          Effect.forever,
          Effect.forkChild,
        )
        const owner = yield* Seed.owner()
        const sessionId = yield* Seed.session(owner)
        yield* Effect.gen(function* () {
          const brains = yield* Brains.Service
          yield* brains
            .start(
              { sessionId, harness: "opencode", interactive: true },
              { ...owner, brainId: Brain.ofSession(sessionId) },
            )
            .pipe(Effect.forkChild)
          const refused = yield* Effect.forEach(Array.from({ length: 5 }), () => Queue.take(answers))
          gate.open = true
          expect([...refused, yield* Queue.take(answers)]).toEqual([503, 503, 503, 503, 503, 200])
        }).pipe(
          Effect.provide(Host.cellLayer({ CELL_URL: cell.url.origin }, Configured.models, Host.noTemplates)),
          Effect.provideService(Clock.Clock, clock),
        )
      }),
    15_000,
  )
})

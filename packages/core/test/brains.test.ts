import { describe, expect, setDefaultTimeout } from "bun:test"
import { Shared } from "@ren/cell/testing"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { Clock, Duration, Effect, Layer, Queue } from "effect"
import { TestClock } from "effect/testing"
import { Brains } from "../src/brains.js"
import { Models } from "../src/models.js"
import { testEffect } from "./lib/effect.js"
import { Host } from "./lib/host.js"
import { Seed } from "./lib/seed.js"

setDefaultTimeout(60_000)

const configured = Shared.access({ stub: Shared.apiKey("sk-configured") }, Shared.stub().url)

const fixed = Layer.succeed(
  Models.Service,
  Models.Service.of({
    catalog: () => Effect.succeed(Models.catalog(configured)),
    grant: () => Effect.succeed(configured),
  }),
)

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
                const body = (await request.json()) as { readonly sessionId: string }
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
          Effect.provide(Host.cellLayer({ CELL_URL: cell.url.origin }, fixed, Host.noTemplates)),
          Effect.provideService(Clock.Clock, clock),
        )
      }),
    15_000,
  )
})

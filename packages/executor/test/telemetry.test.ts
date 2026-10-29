import { expect } from "bun:test"
import { Effect, Schema } from "effect"
import { testEffect } from "./lib/effect.js"
import { TestServer } from "./lib/server.js"

const it = testEffect(TestServer.layer)

const Traces = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        scopeSpans: Schema.Array(Schema.Struct({ spans: Schema.Array(Schema.Struct({ traceId: Schema.String })) })),
      }),
    ),
  }),
)

const traceIds = (bodies: ReadonlyArray<string>) =>
  bodies.flatMap((body) =>
    Schema.decodeUnknownSync(Traces)(body).resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) => scope.spans.map((span) => span.traceId)),
    ),
  )

it.effect("keeps the spans of a call that the brain traces for the next drain, and gives each batch once", () =>
  Effect.gen(function* () {
    const client = yield* TestServer.client()
    const caller = yield* client["executor.hello"]().pipe(
      Effect.andThen(Effect.currentSpan),
      Effect.withSpan("Brain.call"),
    )

    const drain = client["telemetry.drain"]().pipe(Effect.withTracerEnabled(false))
    const drained = yield* drain
    const again = yield* drain

    expect(traceIds(drained.traces)).toContain(caller.traceId)
    expect(again).toEqual({ traces: [], logs: [] })
  }),
)

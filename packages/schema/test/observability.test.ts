import { describe, expect, test } from "bun:test"
import { Effect, Option, Tracer } from "effect"
import { Observability } from "../src/observability.js"

const traced = <A, E>(effect: Effect.Effect<A, E>, minimum: "Info" | "Debug" = "Info") =>
  Effect.runSync(effect.pipe(Effect.provide(Observability.layer(minimum))))

const parentOf = (span: Tracer.Span) => Option.getOrUndefined(span.parent)

describe("Observability", () => {
  test("leaves a span out unless it is inside a traced operation, and keeps every span inside one", () => {
    const spans = traced(
      Effect.gen(function* () {
        const plain = yield* Effect.currentSpan.pipe(Effect.withSpan("Request"))
        const inner = yield* Effect.currentSpan.pipe(Effect.withSpan("Step"), Observability.Trace.chatOpen)
        return { plain, inner, operation: parentOf(inner) }
      }),
    )

    expect(spans.plain.sampled).toBe(false)
    expect(spans.inner.sampled).toBe(true)
    expect(spans.operation?.sampled).toBe(true)
  })

  test("starts its own trace inside an untraced span, and nests inside a traced operation", () => {
    const spans = traced(
      Effect.gen(function* () {
        const own = yield* Effect.currentSpan.pipe(Observability.Trace.chatOpen)
        const nested = yield* Effect.currentSpan.pipe(Observability.Trace.sessionStart, Observability.Trace.chatSend)
        return { own, nested }
      }).pipe(Effect.withSpan("Request")),
    )

    const parent = parentOf(spans.nested)
    expect(parentOf(spans.own)).toBeUndefined()
    expect(parent?._tag === "Span" ? parent.name : undefined).toBe("chat.send")
  })

  test("keeps every span with the minimum trace level Debug", () => {
    const plain = traced(Effect.currentSpan.pipe(Effect.withSpan("Request")), "Debug")
    expect(plain.sampled).toBe(true)
  })
})

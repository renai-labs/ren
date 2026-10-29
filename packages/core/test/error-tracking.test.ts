import { describe, expect } from "bun:test"
import { Cause, ConfigProvider, Effect, Layer, Schema } from "effect"
import { ErrorTracking } from "../src/error-tracking.js"
import { PostHog } from "../src/posthog.js"
import { testEffect } from "./lib/effect.js"

const Batch = Schema.fromJsonString(
  Schema.Struct({
    batch: Schema.Array(
      Schema.Struct({
        event: Schema.String,
        distinct_id: Schema.String,
        properties: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
)

const received: Array<(typeof Batch.Type)["batch"][number]> = []

const posthog = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const body = new Uint8Array(await request.arrayBuffer())
    const text = new TextDecoder().decode(
      request.headers.get("content-encoding") === "gzip" ? Bun.gunzipSync(body) : body,
    )
    received.push(...Schema.decodeUnknownSync(Batch)(text).batch)
    return Response.json({ status: 1 })
  },
})

const reporting = ErrorTracking.layer.pipe(
  Layer.provide(PostHog.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        POSTHOG_PROJECT_KEY: "phc_test",
        POSTHOG_HOST: `http://127.0.0.1:${posthog.port}`,
        REN_VERSION: "test-version",
        REN_DEPLOYMENT: "test",
      }),
    ),
  ),
)

const it = testEffect(Layer.empty)

describe("ErrorTracking", () => {
  it.live("sends a defect to PostHog with the caller, the level, the trace and the release", () =>
    Effect.gen(function* () {
      received.length = 0
      const span = yield* Effect.gen(function* () {
        yield* Effect.die(new Error("boom")).pipe(Effect.withErrorReporting, Effect.exit)
        return yield* Effect.currentSpan
      }).pipe(
        Effect.withSpan("Test.request"),
        Effect.annotateLogs({ posthogDistinctId: "usr_test", "ren.organization.id": "org_test" }),
        Effect.provide(reporting),
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.event).toBe("$exception")
      expect(received[0]?.distinct_id).toBe("usr_test")
      expect(received[0]?.properties).toMatchObject({
        $exception_level: "error",
        $trace_id: span.traceId,
        $span_id: span.spanId,
        "ren.organization.id": "org_test",
        "service.name": "ren-server",
        "service.version": "test-version",
        "deployment.environment.name": "test",
        $exception_list: [{ value: "boom" }],
      })
      expect(received[0]?.properties).not.toHaveProperty("$process_person_profile")
    }),
  )

  it.live(
    "reports an error log that carries a cause once, also after a boundary reported it, and never a warning",
    () =>
      Effect.gen(function* () {
        received.length = 0
        yield* Effect.die(new Error("the run stopped")).pipe(
          Effect.withErrorReporting,
          Effect.catchCause((cause) => Effect.logError("The run stopped", cause)),
          Effect.andThen(Effect.logWarning("The run failed; it retries", Cause.die(new Error("a retry")))),
          Effect.andThen(Effect.logError("The loop failed", Cause.die(new Error("the loop failed")))),
          Effect.provide(reporting),
        )

        expect(received).toHaveLength(2)
        expect(received).toMatchObject([
          { properties: { $exception_list: [{ value: "the run stopped" }] } },
          { properties: { $exception_list: [{ value: "the loop failed" }] } },
        ])
      }),
  )

  it.live("names the server and makes no person profile when no user caused the failure", () =>
    Effect.gen(function* () {
      received.length = 0
      yield* Effect.die(new Error("loop failed")).pipe(
        Effect.withErrorReporting,
        Effect.exit,
        Effect.provide(reporting),
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.distinct_id).toBe("ren-server")
      expect(received[0]?.properties).toMatchObject({ $process_person_profile: false })
    }),
  )
})

import { describe, expect, test } from "bun:test"
import { Cause, ConfigProvider, Effect, Layer, Option, Schema, Tracer } from "effect"
import { FetchHttpClient, HttpRouter } from "effect/http"
import { PostHog } from "../src/posthog.js"
import { Telemetry } from "../src/telemetry.js"

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

const reporting = PostHog.layer.pipe(
  Layer.provideMerge(
    Telemetry.layer({
      resource: {
        serviceName: "ren-server",
        serviceVersion: "test-version",
        attributes: { "deployment.environment.name": "test" },
      },
      traces: Option.none(),
      logs: Option.none(),
      metrics: Option.none(),
    }),
  ),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        POSTHOG_PROJECT_KEY: "phc_test",
        POSTHOG_HOST: `http://127.0.0.1:${posthog.port}`,
      }),
    ),
  ),
)

describe("PostHog.layer", () => {
  test("sends a defect to PostHog with the caller, the replay, the level, the trace and the release", () =>
    Effect.gen(function* () {
      received.length = 0
      const span = yield* Effect.gen(function* () {
        yield* Effect.die(new Error("boom")).pipe(Effect.withErrorReporting, Effect.exit)
        return yield* Effect.currentSpan
      }).pipe(
        Effect.withSpan("Test.request"),
        Effect.annotateLogs({
          "user.id": "usr_test",
          sessionId: "01a18979-847a-7000-8000-000000000000",
          "ren.organization.id": "org_test",
        }),
        Effect.provide(reporting),
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.event).toBe("$exception")
      expect(received[0]?.distinct_id).toBe("usr_test")
      expect(received[0]?.properties).toMatchObject({
        $exception_level: "error",
        $session_id: "01a18979-847a-7000-8000-000000000000",
        $trace_id: span.traceId,
        $span_id: span.spanId,
        "ren.organization.id": "org_test",
        "service.name": "ren-server",
        "service.version": "test-version",
        "deployment.environment.name": "test",
        $exception_list: [{ value: "boom" }],
      })
      expect(received[0]?.properties).not.toHaveProperty("$process_person_profile")
    }).pipe(Effect.runPromise))

  test("reports an error log that carries a cause once, also after a boundary reported it, and never a warning", () =>
    Effect.gen(function* () {
      received.length = 0
      yield* Effect.die(new Error("the run stopped")).pipe(
        Effect.withErrorReporting,
        Effect.catchCause((cause) => Effect.logError("The run stopped", cause)),
        Effect.andThen(Effect.logWarning("The run failed; it retries", Cause.die(new Error("a retry")))),
        Effect.andThen(Effect.logError("The loop failed", Cause.die(new Error("the loop failed")))),
        Effect.provide(reporting),
      )

      const exception = (value: string) =>
        expect.objectContaining({
          properties: expect.objectContaining({ $exception_list: [expect.objectContaining({ value })] }),
        })
      expect(received).toHaveLength(2)
      expect(received).toEqual(expect.arrayContaining([exception("the run stopped"), exception("the loop failed")]))
    }).pipe(Effect.runPromise))

  test("reports an error log without a cause as an ErrorLog with no stack, so its message alone groups it", () =>
    Effect.gen(function* () {
      received.length = 0
      const errorLog = (value: string) =>
        expect.objectContaining({ type: "ErrorLog", value, stacktrace: { type: "raw", frames: [] } })
      yield* Effect.all([
        Effect.logError("The brain rejected a start").pipe(Effect.annotateLogs({ "ren.session.id": "ses_a" })),
        Effect.logError("The brain rejected a start").pipe(Effect.annotateLogs({ "ren.session.id": "ses_b" })),
        Effect.logFatal("Ren cannot start"),
        Effect.logWarning("A retry"),
      ]).pipe(Effect.provide(reporting))

      expect(
        received.map((event) => [
          event.properties["$exception_list"],
          event.properties["$exception_level"],
          event.properties["ren.session.id"],
        ]),
      ).toEqual([
        [[errorLog("The brain rejected a start")], "error", "ses_a"],
        [[errorLog("The brain rejected a start")], "error", "ses_b"],
        [[errorLog("Ren cannot start")], "fatal", undefined],
      ])
    }).pipe(Effect.runPromise))

  test("names the HTTP route and path of the request that failed, though its span is not exported", () =>
    Effect.gen(function* () {
      received.length = 0
      const app = HttpRouter.toWebHandler(
        HttpRouter.add(
          "GET",
          "/sessions/:id",
          Effect.die(new Error("the handler failed")).pipe(Effect.withErrorReporting),
        ).pipe(Layer.provideMerge(reporting)),
        { disableLogger: true },
      )
      yield* Effect.promise(() => app.handler(new Request("http://localhost/sessions/ses_test?cursor=secret")))
      yield* Effect.promise(() => app.dispose())

      expect(received).toHaveLength(1)
      expect(received[0]?.properties).toMatchObject({ "http.route": "/sessions/:id", "url.path": "/sessions/ses_test" })
    }).pipe(Effect.runPromise))

  test("leaves out the trace of a failure whose trace is not exported", () =>
    Effect.gen(function* () {
      received.length = 0
      yield* Effect.die(new Error("an untraced failure")).pipe(
        Effect.withErrorReporting,
        Effect.withSpan("Test.untraced"),
        Effect.provideService(Tracer.CurrentTraceLevel, "Debug"),
        Effect.provideService(Tracer.MinimumTraceLevel, "Info"),
        Effect.exit,
        Effect.provide(reporting),
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.properties).not.toHaveProperty("$trace_id")
    }).pipe(Effect.runPromise))

  test("leaves the parameters of a failed query out of the exception", () =>
    Effect.gen(function* () {
      received.length = 0
      yield* Effect.die(new Error("Failed query: insert into message values ($1)\nparams: a private message")).pipe(
        Effect.withErrorReporting,
        Effect.exit,
        Effect.provide(reporting),
      )

      expect(received).toHaveLength(1)
      expect(received[0]?.properties).toMatchObject({
        $exception_list: [{ value: "Failed query: insert into message values ($1)" }],
      })
    }).pipe(Effect.runPromise))

  test("names the server and makes no person profile when no user caused the failure", () =>
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
    }).pipe(Effect.runPromise))
})

describe("PostHog.variables", () => {
  const variables = (env: Record<string, string>) =>
    Effect.runSync(PostHog.variables.pipe(Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(env)))))

  test("gives a sandbox PostHog's OTLP endpoint and token, and nothing without a key", () => {
    const sandbox = variables({ POSTHOG_PROJECT_KEY: "phc_test", POSTHOG_HOST: "https://eu.i.posthog.com/" })
    const target = (signal: string) =>
      Option.some({ url: `https://eu.i.posthog.com/i/v1/${signal}`, headers: { authorization: "Bearer phc_test" } })

    expect(Effect.runSync(Telemetry.targets.parse(ConfigProvider.fromEnv({ env: sandbox })))).toEqual({
      traces: target("traces"),
      logs: target("logs"),
      metrics: target("metrics"),
    })
    expect(variables({})).toEqual({})
  })
})

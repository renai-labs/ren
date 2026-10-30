import { describe, expect, test } from "bun:test"
import {
  Cause,
  Config,
  ConfigProvider,
  Duration,
  Effect,
  ErrorReporter,
  Layer,
  Logger,
  Metric,
  Option,
  Schema,
  Tracer,
} from "effect"
import { FetchHttpClient } from "effect/http"
import { OtlpExporter } from "effect/observability"
import { Telemetry } from "../src/telemetry.js"

const Attributes = Schema.Array(
  Schema.Struct({ key: Schema.String, value: Schema.Struct({ stringValue: Schema.optional(Schema.String) }) }),
)

const Logs = Schema.fromJsonString(
  Schema.Struct({
    resourceLogs: Schema.Array(
      Schema.Struct({
        scopeLogs: Schema.Array(
          Schema.Struct({
            logRecords: Schema.Array(
              Schema.Struct({ body: Schema.Struct({ stringValue: Schema.String }), attributes: Attributes }),
            ),
          }),
        ),
      }),
    ),
  }),
)

const Traces = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        scopeSpans: Schema.Array(
          Schema.Struct({ spans: Schema.Array(Schema.Struct({ name: Schema.String, attributes: Attributes })) }),
        ),
      }),
    ),
  }),
)

const Metrics = Schema.fromJsonString(
  Schema.Struct({
    resourceMetrics: Schema.Array(
      Schema.Struct({
        scopeMetrics: Schema.Array(
          Schema.Struct({
            metrics: Schema.Array(
              Schema.Struct({
                name: Schema.String,
                histogram: Schema.optional(
                  Schema.Struct({ dataPoints: Schema.Array(Schema.Struct({ count: Schema.Number })) }),
                ),
              }),
            ),
          }),
        ),
      }),
    ),
  }),
)

const bodies: Record<string, Array<string>> = { traces: [], logs: [], metrics: [] }

const receiver = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    if (path.startsWith("/refuse/")) return new Response(null, { status: 400 })
    bodies[path.slice(4)]?.push(await request.text())
    return Response.json({})
  },
})

const attributes = (values: typeof Attributes.Type) =>
  Object.fromEntries(values.map((attribute) => [attribute.key, attribute.value.stringValue]))

const logs = () =>
  (bodies["logs"] ?? []).flatMap((body) =>
    Schema.decodeUnknownSync(Logs)(body).resourceLogs.flatMap((resource) =>
      resource.scopeLogs.flatMap((scope) =>
        scope.logRecords.map((record) => ({
          body: record.body.stringValue,
          attributes: attributes(record.attributes),
        })),
      ),
    ),
  )

const spans = () =>
  (bodies["traces"] ?? []).flatMap((body) =>
    Schema.decodeUnknownSync(Traces)(body).resourceSpans.flatMap((resource) =>
      resource.scopeSpans.flatMap((scope) =>
        scope.spans.map((span) => ({ name: span.name, attributes: attributes(span.attributes) })),
      ),
    ),
  )

const target = (signal: string) => Option.some({ url: `http://127.0.0.1:${receiver.port}/v1/${signal}`, headers: {} })

const resource = {
  serviceName: "ren-test",
  serviceVersion: "test",
  attributes: { "deployment.environment.name": "test" },
}

const telemetry = Telemetry.layer({
  resource,
  traces: target("traces"),
  logs: target("logs"),
  metrics: target("metrics"),
})

const run = <A, E>(effect: Effect.Effect<A, E, OtlpExporter.Flusher>, layer = telemetry) => {
  bodies["traces"] = []
  bodies["logs"] = []
  bodies["metrics"] = []
  return effect.pipe(Effect.provide(layer), Effect.provide(FetchHttpClient.layer), Effect.runPromise)
}

describe("Telemetry.layer", () => {
  test("exports error logs and spans, and leaves out info logs and query strings", async () => {
    await run(
      Effect.gen(function* () {
        yield* Effect.logInfo("an info log")
        yield* Effect.logError("an error log")
        yield* Effect.annotateCurrentSpan({
          "url.full": "https://ren.test/reset?token=secret",
          "url.query": "token=secret",
        })
      }).pipe(Effect.withSpan("Test.request")),
    )

    expect(logs().map((log) => log.body)).toEqual(["an error log"])
    expect(spans()).toHaveLength(1)
    expect(spans()[0]?.name).toBe("Test.request")
    expect(spans()[0]?.attributes["url.full"]).toBe("https://ren.test/reset")
    expect(spans()[0]?.attributes).not.toHaveProperty("url.query")
  })

  test("exports each metric's change since its last export, so that processes reporting one series add up", async () => {
    const timer = Metric.timer("ren.test.duration")
    await run(
      Effect.gen(function* () {
        const flusher = yield* OtlpExporter.Flusher
        yield* Metric.update(timer, Duration.millis(10))
        yield* flusher.flush
        yield* Metric.update(timer, Duration.millis(20))
        yield* Metric.update(timer, Duration.millis(30))
      }),
    )

    const counts = (bodies["metrics"] ?? []).flatMap((body) =>
      Schema.decodeUnknownSync(Metrics)(body).resourceMetrics.flatMap((resource) =>
        resource.scopeMetrics.flatMap((scope) =>
          scope.metrics
            .filter((metric) => metric.name === "ren.test.duration")
            .flatMap((metric) => metric.histogram?.dataPoints.map((point) => point.count) ?? []),
        ),
      ),
    )
    expect(counts).toEqual([1, 2])
  })

  test("leaves the parameters of a failed query out of an exported log", async () => {
    const failed = Object.assign(
      new Error("Failed query: select * from member where email = $1\nparams: ada@example.com"),
      {
        name: "EffectDrizzleQueryError",
      },
    )
    await run(Effect.logError("A lookup failed", Cause.die(failed)))

    expect(bodies["logs"]?.join("")).toContain("Failed query: select * from member where email = $1")
    expect(bodies["logs"]?.join("")).not.toContain("ada@example.com")
  })

  test("keeps the spans under a sampled caller only with continueTraces, and drops an unsampled root", async () => {
    const caller = Tracer.externalSpan({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      sampled: true,
    })
    const program = Effect.gen(function* () {
      yield* Effect.void.pipe(
        Effect.withSpan("Test.continued.child"),
        Effect.withSpan("Test.continued", { parent: caller }),
      )
      yield* Effect.void.pipe(Effect.withSpan("Test.untraced"))
    }).pipe(
      Effect.provideService(Tracer.CurrentTraceLevel, "Debug"),
      Effect.provideService(Tracer.MinimumTraceLevel, "Info"),
    )

    await run(program)
    expect(spans()).toEqual([])

    await run(
      program,
      Telemetry.layer({
        resource,
        traces: target("traces"),
        logs: Option.none(),
        metrics: Option.none(),
        continueTraces: true,
      }),
    )
    expect(
      spans()
        .map((span) => span.name)
        .toSorted(),
    ).toEqual(["Test.continued", "Test.continued.child"])
  })

  test("exports each reported failure as an exception record, once, and none for an ignored one", async () => {
    const failed = Object.assign(new Error("Failed query: select 1\nparams: ada@example.com"), { name: "QueryError" })
    const ignored = Object.assign(new Error("not found"), { [ErrorReporter.ignore]: true })
    await run(
      Effect.gen(function* () {
        yield* Effect.die(failed).pipe(Effect.withErrorReporting, Effect.ignoreCause)
        yield* Effect.fail(ignored).pipe(Effect.withErrorReporting, Effect.ignore)
        yield* Effect.logError("A sync failed", Cause.fail(new Error("upstream answered 502")))
      }).pipe(Effect.annotateLogs({ "ren.session.id": "ses_test" })),
      Telemetry.layer({
        resource,
        traces: Option.none(),
        logs: target("logs"),
        metrics: Option.none(),
      }),
    )

    const exceptions = logs().filter((log) => log.attributes["exception.type"] !== undefined)
    expect(exceptions.map((log) => [log.attributes["exception.type"], log.attributes["exception.message"]])).toEqual([
      ["QueryError", "Failed query: select 1"],
      ["Error", "upstream answered 502"],
    ])
    expect(exceptions[0]?.attributes["exception.stacktrace"]).toContain("QueryError: Failed query: select 1")
    expect(exceptions[0]?.attributes["ren.session.id"]).toBe("ses_test")
    expect(bodies["logs"]?.join("")).not.toContain("ada@example.com")
  })

  test("sends an error log and a reported failure to each reporter and to OTLP once, also a failure that was logged before a boundary reported it", async () => {
    const reported: Array<string> = []
    const failure = new Error("the write failed")
    await run(
      Effect.gen(function* () {
        yield* Effect.logError("A sync failed")
        yield* Effect.die(new Error("the loop failed")).pipe(Effect.withErrorReporting, Effect.ignoreCause)
        yield* Effect.logError("A write failed", Cause.die(failure))
        yield* Effect.die(failure).pipe(Effect.withErrorReporting, Effect.ignoreCause)
      }),
      ErrorReporter.layer([ErrorReporter.make((report) => void reported.push(report.error.message))], {
        mergeWithExisting: true,
      }).pipe(
        Layer.provideMerge(
          Telemetry.layer({
            resource,
            traces: Option.none(),
            logs: target("logs"),
            metrics: Option.none(),
          }),
        ),
      ),
    )

    expect(reported).toEqual(["A sync failed", "the loop failed", "the write failed"])
    expect(logs().map((log) => log.body)).toEqual(["A sync failed", "the loop failed", "A write failed"])
  })

  test("logs a warning when the backend refuses an export, which Effect would otherwise drop silently", async () => {
    const warnings: Array<unknown> = []
    await Effect.void.pipe(
      Effect.withSpan("Test.refused"),
      Effect.provide(
        Telemetry.layer({
          resource,
          traces: Option.some({ url: `http://127.0.0.1:${receiver.port}/refuse/v1/traces`, headers: {} }),
          logs: Option.none(),
          metrics: Option.none(),
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
      Effect.provide(
        Logger.layer([Logger.make((log) => (log.logLevel === "Warn" ? warnings.push(log.message) : undefined))]),
      ),
      Effect.runPromise,
    )

    expect(warnings.flat()).toEqual([
      `A telemetry export to http://127.0.0.1:${receiver.port}/refuse/v1/traces answered 400`,
    ])
  })
})

describe("Telemetry.targets", () => {
  const read = <A>(env: Record<string, string>, config: Config.Config<A>) =>
    Effect.runSync(config.parse(ConfigProvider.fromEnv({ env })))

  const server = {
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://us.i.posthog.com/i/",
    OTEL_EXPORTER_OTLP_HEADERS: "authorization=Bearer%20phc_test",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otlp.example.com/v1/traces",
    OTEL_EXPORTER_OTLP_TRACES_HEADERS: "authorization=Bearer%20abc%20123, x-team=ren",
    OTEL_METRICS_EXPORTER: "none",
  }

  test("reads a signal's own endpoint and headers, the shared ones for the rest, and none as off", () => {
    expect(read(server, Telemetry.targets)).toEqual({
      traces: Option.some({
        url: "https://otlp.example.com/v1/traces",
        headers: { authorization: "Bearer abc 123", "x-team": "ren" },
      }),
      logs: Option.some({ url: "https://us.i.posthog.com/i/v1/logs", headers: { authorization: "Bearer phc_test" } }),
      metrics: Option.none(),
    })
    expect(read({}, Telemetry.targets)).toEqual({
      traces: Option.none(),
      logs: Option.none(),
      metrics: Option.none(),
    })
  })

  test("gives a sandbox variables that read back as the same targets and attributes", () => {
    const targets = read(server, Telemetry.targets)
    const attributes = { "deployment.environment.name": "production", "ren.brain.id": "brn_test=1,2" }
    const variables = Telemetry.variables({ ...targets, attributes })

    expect(read(variables, Telemetry.targets)).toEqual(targets)
    expect(read(variables, Telemetry.attributes)).toEqual(attributes)
  })
})

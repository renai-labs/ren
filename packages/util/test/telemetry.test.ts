import { describe, expect, test } from "bun:test"
import { Cause, Effect, Logger, Option, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
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
            logRecords: Schema.Array(Schema.Struct({ body: Schema.Struct({ stringValue: Schema.String }) })),
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

const logs: Array<string> = []
const logBodies: Array<string> = []
const spans: Array<{ readonly name: string; readonly attributes: Record<string, string | undefined> }> = []

const receiver = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const body = await request.text()
    if (new URL(request.url).pathname.startsWith("/refuse/")) return new Response(null, { status: 400 })
    if (new URL(request.url).pathname === "/v1/logs") logBodies.push(body)
    if (new URL(request.url).pathname === "/v1/logs")
      logs.push(
        ...Schema.decodeUnknownSync(Logs)(body).resourceLogs.flatMap((resource) =>
          resource.scopeLogs.flatMap((scope) => scope.logRecords.map((record) => record.body.stringValue)),
        ),
      )
    else
      spans.push(
        ...Schema.decodeUnknownSync(Traces)(body).resourceSpans.flatMap((resource) =>
          resource.scopeSpans.flatMap((scope) =>
            scope.spans.map((span) => ({
              name: span.name,
              attributes: Object.fromEntries(
                span.attributes.map((attribute) => [attribute.key, attribute.value.stringValue]),
              ),
            })),
          ),
        ),
      )
    return Response.json({})
  },
})

const target = (signal: string) => Option.some({ url: `http://127.0.0.1:${receiver.port}/v1/${signal}`, headers: {} })

const telemetry = Telemetry.layer({
  resource: { serviceName: "ren-test", serviceVersion: "test", attributes: { "deployment.environment.name": "test" } },
  traces: target("traces"),
  logs: target("logs"),
})

describe("Telemetry.layer", () => {
  test("exports error logs and spans, and leaves out info logs and query strings", async () => {
    await Effect.gen(function* () {
      yield* Effect.logInfo("an info log")
      yield* Effect.logError("an error log")
      yield* Effect.annotateCurrentSpan({
        "url.full": "https://ren.test/reset?token=secret",
        "url.query": "token=secret",
      })
    }).pipe(
      Effect.withSpan("Test.request"),
      Effect.provide(telemetry),
      Effect.provide(FetchHttpClient.layer),
      Effect.runPromise,
    )

    expect(logs).toEqual(["an error log"])
    expect(spans).toHaveLength(1)
    expect(spans[0]?.name).toBe("Test.request")
    expect(spans[0]?.attributes["url.full"]).toBe("https://ren.test/reset")
    expect(spans[0]?.attributes).not.toHaveProperty("url.query")
  })

  test("leaves the parameters of a failed query out of an exported log", async () => {
    logBodies.length = 0
    const failed = Object.assign(
      new Error("Failed query: select * from member where email = $1\nparams: ada@example.com"),
      {
        name: "EffectDrizzleQueryError",
      },
    )
    await Effect.logError("A lookup failed", Cause.die(failed)).pipe(
      Effect.provide(telemetry),
      Effect.provide(FetchHttpClient.layer),
      Effect.runPromise,
    )

    expect(logBodies.join("")).toContain("Failed query: select * from member where email = $1")
    expect(logBodies.join("")).not.toContain("ada@example.com")
  })

  test("logs a warning when the backend refuses an export, which Effect would otherwise drop silently", async () => {
    const warnings: Array<unknown> = []
    await Effect.void.pipe(
      Effect.withSpan("Test.refused"),
      Effect.provide(
        Telemetry.layer({
          resource: { serviceName: "ren-test", serviceVersion: "test", attributes: {} },
          traces: Option.some({ url: `http://127.0.0.1:${receiver.port}/refuse/v1/traces`, headers: {} }),
          logs: Option.none(),
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

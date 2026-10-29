import { describe, expect } from "bun:test"
import { Auth } from "@ren/schema/auth"
import { Brain } from "@ren/schema/brain"
import { Space } from "@ren/schema/space"
import type { Telemetry } from "@ren/util/telemetry"
import { ConfigProvider, Effect, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/http"
import { PostHog } from "../src/posthog.js"
import { TelemetryRelay } from "../src/telemetry-relay.js"
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

const exported: Record<string, Array<unknown>> = { traces: [], logs: [] }
const exceptions: Array<(typeof Batch.Type)["batch"][number]> = []

const receiver = Bun.serve({
  port: 0,
  fetch: async (request) => {
    const path = new URL(request.url).pathname
    const body = new Uint8Array(await request.arrayBuffer())
    const text = new TextDecoder().decode(
      request.headers.get("content-encoding") === "gzip" ? Bun.gunzipSync(body) : body,
    )
    if (path === "/v1/traces" || path === "/v1/logs")
      exported[path.slice(4)]?.push(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(text))
    else exceptions.push(...Schema.decodeUnknownSync(Batch)(text).batch)
    return Response.json({ status: 1 })
  },
})

const relay = TelemetryRelay.layer.pipe(
  Layer.provide(PostHog.layer),
  Layer.provide(FetchHttpClient.layer),
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${receiver.port}/v1/traces`,
        OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `http://127.0.0.1:${receiver.port}/v1/logs`,
        POSTHOG_PROJECT_KEY: "phc_test",
        POSTHOG_HOST: `http://127.0.0.1:${receiver.port}`,
        REN_DEPLOYMENT: "test",
      }),
    ),
  ),
)

const it = testEffect(Layer.empty)

const host = {
  brainId: Brain.ID.create(),
  organizationId: Auth.OrganizationID.create(),
  spaceId: Space.ID.create(),
  generation: 3,
}

const text = (key: string, value: string) => ({ key, value: { stringValue: value } })

const forged = {
  attributes: [
    text("service.name", "ren-server"),
    text("service.version", "brain-1"),
    text("deployment.environment.name", "production"),
    text("ren.organization.id", "org_other"),
    text("ren.space.id", "spc_other"),
  ],
}

const attributesOf = (value: unknown) =>
  Object.fromEntries(
    Schema.decodeUnknownSync(
      Schema.Array(Schema.Struct({ key: Schema.String, value: Schema.Record(Schema.String, Schema.Unknown) })),
    )(value).map((attribute) => [attribute.key, Object.values(attribute.value)[0]]),
  )

const Resources = Schema.Struct({
  resourceSpans: Schema.Array(
    Schema.Struct({ resource: Schema.Struct({ attributes: Schema.Unknown }), scopeSpans: Schema.Unknown }),
  ),
})

describe("TelemetryRelay", () => {
  it.live("forwards a brain's spans with the tenant of its host token, whatever the brain wrote", () =>
    Effect.gen(function* () {
      exported["traces"] = []
      const span = {
        traceId: "0af7651916cd43dd8448eb211c80319c",
        spanId: "b7ad6b7169203331",
        name: "BrainApi.send",
        kind: 2,
        startTimeUnixNano: "1",
        endTimeUnixNano: "2",
        attributes: [],
        events: [],
        status: { code: 1 },
        links: [],
      }
      const batch: Telemetry.Traces = {
        resourceSpans: [{ resource: forged, scopeSpans: [{ scope: { name: "ren-brain" }, spans: [span] }] }],
      }
      yield* Effect.gen(function* () {
        const telemetry = yield* TelemetryRelay.Service
        yield* telemetry.traces(host, batch)
      }).pipe(Effect.provide(relay))

      const forwarded = Schema.decodeUnknownSync(Resources)(exported["traces"]?.[0]).resourceSpans
      expect(forwarded).toHaveLength(1)
      expect(attributesOf(forwarded[0]?.resource.attributes)).toEqual({
        "service.name": "ren-brain",
        "service.version": "brain-1",
        "deployment.environment.name": "test",
        "ren.organization.id": host.organizationId,
        "ren.space.id": host.spaceId,
        "ren.brain.id": host.brainId,
        "ren.brain.generation": "3",
      })
      expect(forwarded[0]?.scopeSpans).toEqual([{ scope: { name: "ren-brain" }, spans: [span] }])
    }),
  )

  it.live("forwards a brain's logs, and reports each exception record to error tracking as the brain", () =>
    Effect.gen(function* () {
      exported["logs"] = []
      exceptions.length = 0
      const batch: Telemetry.Logs = {
        resourceLogs: [
          {
            resource: forged,
            scopeLogs: [
              {
                scope: { name: "ren-brain" },
                logRecords: [
                  {
                    timeUnixNano: "1",
                    severityText: "Error",
                    body: { stringValue: "The sync failed" },
                    attributes: [text("ren.session.id", "ses_test")],
                  },
                  {
                    timeUnixNano: "2",
                    severityText: "Fatal",
                    body: { stringValue: "boom" },
                    traceId: "0af7651916cd43dd8448eb211c80319c",
                    spanId: "b7ad6b7169203331",
                    attributes: [
                      text("exception.type", "TypeError"),
                      text("exception.message", "boom"),
                      text(
                        "exception.stacktrace",
                        "TypeError: boom\n    at run (/opt/ren/packages/cell/src/bun.ts:1:1)",
                      ),
                      text("ren.session.id", "ses_test"),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }
      yield* Effect.gen(function* () {
        const telemetry = yield* TelemetryRelay.Service
        yield* telemetry.logs(host, batch)
      }).pipe(Effect.provide(relay))

      expect(JSON.stringify(exported["logs"])).toContain("The sync failed")
      expect(exceptions).toHaveLength(1)
      expect(exceptions[0]?.event).toBe("$exception")
      expect(exceptions[0]?.distinct_id).toBe(host.brainId)
      expect(exceptions[0]?.properties).toMatchObject({
        $exception_level: "fatal",
        $exception_list: [{ type: "TypeError", value: "boom" }],
        $process_person_profile: false,
        $trace_id: "0af7651916cd43dd8448eb211c80319c",
        $span_id: "b7ad6b7169203331",
        "ren.session.id": "ses_test",
        "ren.organization.id": host.organizationId,
        "service.name": "ren-brain",
      })
    }),
  )
})

export * as TelemetryRelay from "./telemetry-relay.js"

import type { CurrentHost } from "@ren/host-api/ren-host-api"
import { Telemetry } from "@ren/util/telemetry"
import { Context, Effect, Layer, Option } from "effect"
import { HttpBody } from "effect/http"
import { OtlpExporter } from "effect/observability"
import { Deployment } from "./deployment.js"
import { PostHog } from "./posthog.js"

type Host = CurrentHost["Service"]

type Resource = Telemetry.Traces["resourceSpans"][number]["resource"]

export interface Interface {
  readonly traces: (host: Host, batch: Telemetry.Traces) => Effect.Effect<void>
  readonly logs: (host: Host, batch: Telemetry.Logs) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/TelemetryRelay") {}

const services = new Set(["ren-brain", "ren-executor"])

const plain = (value: Telemetry.KeyValue["value"]) =>
  value.stringValue ?? value.boolValue ?? value.intValue ?? value.doubleValue ?? undefined

const record = (attributes: ReadonlyArray<Telemetry.KeyValue>) =>
  Object.fromEntries(attributes.map((attribute) => [attribute.key, plain(attribute.value)]))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const telemetry = yield* Deployment.telemetry
    const posthog = yield* PostHog.Service

    const exporter = (target: Option.Option<Telemetry.Target>, key: "resourceSpans" | "resourceLogs") =>
      Option.match(target, {
        onNone: () => Effect.succeed<(item: unknown) => void>(() => {}),
        onSome: (found) =>
          Effect.map(
            OtlpExporter.make({
              ...found,
              label: `Relay ${key}`,
              exportInterval: "1 second",
              maxBatchSize: 25,
              shutdownTimeout: "3 seconds",
              body: (items) => [HttpBody.jsonUnsafe({ [key]: items }), Effect.void],
            }),
            (made) => made.push,
          ),
      })

    const pushSpans = yield* exporter(telemetry.traces, "resourceSpans")
    const pushLogs = yield* exporter(telemetry.logs, "resourceLogs")

    const stamp = (host: Host, resource: Resource): Resource => {
      const name = resource.attributes.find((attribute) => attribute.key === "service.name")?.value.stringValue
      const tenant = {
        ...telemetry.resource.attributes,
        "service.name": name && services.has(name) ? name : "ren-brain",
        "ren.organization.id": host.organizationId,
        "ren.space.id": host.spaceId,
        "ren.brain.id": host.brainId,
        "ren.brain.generation": String(host.generation),
      }
      return {
        ...resource,
        attributes: [
          ...resource.attributes.filter((attribute) => !(attribute.key in tenant)),
          ...Object.entries(tenant).map(([key, value]) => ({ key, value: { stringValue: value } })),
        ],
      }
    }

    return Service.of({
      traces: Effect.fn("TelemetryRelay.traces")(function* (host, batch) {
        for (const resourceSpans of batch.resourceSpans)
          pushSpans({ ...resourceSpans, resource: stamp(host, resourceSpans.resource) })
      }),
      logs: Effect.fn("TelemetryRelay.logs")(function* (host, batch) {
        for (const resourceLogs of batch.resourceLogs) {
          const resource = stamp(host, resourceLogs.resource)
          pushLogs({ ...resourceLogs, resource })
          const exceptions = resourceLogs.scopeLogs.flatMap((scope) =>
            scope.logRecords.flatMap((log) => {
              const attributes = record(log.attributes)
              return attributes["exception.type"] ? [{ log, attributes }] : []
            }),
          )
          for (const found of exceptions)
            posthog.captureException(
              Object.assign(new Error(String(found.attributes["exception.message"] ?? "")), {
                name: String(found.attributes["exception.type"]),
                stack: String(found.attributes["exception.stacktrace"] ?? ""),
              }),
              host.brainId,
              {
                ...record(found.log.attributes.filter((attribute) => !attribute.key.startsWith("exception."))),
                ...record(resource.attributes),
                $exception_level: found.log.severityText === "Fatal" ? "fatal" : "error",
                $process_person_profile: false,
                ...(found.log.traceId && { $trace_id: found.log.traceId, $span_id: found.log.spanId }),
              },
            )
        }
      }),
    })
  }),
).pipe(Layer.provide([OtlpExporter.layerFlusher, Telemetry.warnOnFailure]))

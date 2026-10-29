import { Telemetry } from "@ren/util/telemetry"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { HostAuthentication } from "./ren-host-api.js"

export const maxBodyBytes = 4 * 1024 * 1024

const TelemetryGroup = HttpApiGroup.make("telemetry")
  .add(
    HttpApiEndpoint.post("telemetry.traces", "/host/telemetry/v1/traces", { payload: Telemetry.Traces }).annotateMerge(
      OpenApi.annotations({
        identifier: "telemetry.traces",
        summary: "Export spans",
        description: "An OTLP/JSON trace export. Ren sets the tenant of each resource from the host token.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("telemetry.logs", "/host/telemetry/v1/logs", { payload: Telemetry.Logs }).annotateMerge(
      OpenApi.annotations({
        identifier: "telemetry.logs",
        summary: "Export log records",
        description:
          "An OTLP/JSON log export. Ren sets the tenant of each resource from the host token, and reports each record with an `exception.type` as an error.",
      }),
    ),
  )
  .middleware(HostAuthentication)
  .annotateMerge(OpenApi.annotations({ title: "telemetry" }))

export const TelemetryApi = HttpApi.make("telemetry")
  .add(TelemetryGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "Ren Telemetry API",
      version: "0.0.0",
      description: `Internal API a brain sends its traces and critical logs to, so that its sandbox holds no telemetry key. Ren refuses a body larger than ${maxBodyBytes} bytes.`,
    }),
  )

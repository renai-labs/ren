import { CurrentHost } from "@ren/host-api/ren-host-api"
import { TelemetryApi } from "@ren/host-api/telemetry-api"
import { TelemetryRelay } from "@ren/core/telemetry-relay"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"

export const HostTelemetryHandler = HttpApiBuilder.group(TelemetryApi, "telemetry", (handlers) =>
  Effect.gen(function* () {
    const relay = yield* TelemetryRelay.Service
    return handlers
      .handle("telemetry.traces", (request) =>
        Effect.gen(function* () {
          yield* relay.traces(yield* CurrentHost, request.payload)
        }),
      )
      .handle("telemetry.logs", (request) =>
        Effect.gen(function* () {
          yield* relay.logs(yield* CurrentHost, request.payload)
        }),
      )
  }),
)

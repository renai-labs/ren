export * as BrainTelemetry from "./brain-telemetry.js"

import { Observability } from "@ren/schema/observability"
import { Telemetry } from "@ren/telemetry/telemetry"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { Cell } from "./cell.js"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const cell = yield* Cell.Info
    const attributes = yield* Telemetry.attributes
    const resource = { serviceName: "ren-brain", serviceVersion: cell.version, attributes }
    return Telemetry.layer({
      ...(yield* Telemetry.targets),
      resource,
      metricsResource: {
        ...resource,
        attributes: Object.fromEntries(Object.entries(attributes).filter((entry) => !entry.at(0)?.startsWith("ren."))),
      },
      reportErrors: true,
      continueTraces: true,
    }).pipe(Layer.provideMerge(Observability.layer("Info")), Layer.provide(FetchHttpClient.layer))
  }),
)

export * as ExecutorTelemetry from "./telemetry.js"

import { ExecutorVariables } from "@ren/hand-api/executor-variables"
import { Hand } from "@ren/schema/hand"
import { Observability } from "@ren/schema/observability"
import { Telemetry } from "@ren/telemetry/telemetry"
import { Config, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import manifest from "../package.json"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environmentId = yield* Config.schema(Hand.ID, ExecutorVariables.environmentId)
    return Telemetry.layer({
      ...(yield* Telemetry.targets),
      metrics: Option.none(),
      resource: {
        serviceName: "ren-executor",
        serviceVersion: manifest.version,
        attributes: { ...(yield* Telemetry.attributes), "ren.environment.id": environmentId },
      },
      continueTraces: true,
    }).pipe(Layer.provideMerge(Observability.layer("Info")), Layer.provide(FetchHttpClient.layer))
  }),
)

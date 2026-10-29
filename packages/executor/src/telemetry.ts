export * as ExecutorTelemetry from "./telemetry.js"

import type { EnvironmentApi } from "@ren/environment-api/environment-api"
import { ExecutorVariables } from "@ren/environment-api/executor-variables"
import { Environment } from "@ren/schema/environment"
import { Observability } from "@ren/schema/observability"
import { Telemetry } from "@ren/util/telemetry"
import { Config, Context, Effect, Layer, Option, Ref } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { OtlpExporter } from "effect/observability"
import manifest from "../package.json"

const kept = 50

const memory = "http://executor.invalid/v1"

export class Service extends Context.Service<Service, { readonly drain: Effect.Effect<EnvironmentApi.Drained> }>()(
  "@ren/executor/ExecutorTelemetry",
) {}

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environmentId = yield* Config.schema(Environment.ID, ExecutorVariables.environmentId)
    const batches = yield* Ref.make<EnvironmentApi.Drained>({ traces: [], logs: [] })
    const keep = HttpClient.make((request) =>
      Ref.update(batches, (held) => {
        const signal = request.url.endsWith("/logs") ? "logs" : "traces"
        const body = request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : ""
        const add = (batches: ReadonlyArray<string>) => [...batches, body].slice(-kept)
        return signal === "logs"
          ? { traces: held.traces, logs: add(held.logs) }
          : { traces: add(held.traces), logs: held.logs }
      }).pipe(Effect.as(HttpClientResponse.fromWeb(request, new Response(null, { status: 200 })))),
    )
    return Layer.effect(
      Service,
      Effect.gen(function* () {
        const flusher = yield* OtlpExporter.Flusher
        return Service.of({
          drain: flusher.flush.pipe(Effect.andThen(Ref.getAndSet(batches, { traces: [], logs: [] }))),
        })
      }),
    ).pipe(
      Layer.provideMerge(
        Telemetry.layer({
          resource: {
            serviceName: "ren-executor",
            serviceVersion: manifest.version,
            attributes: { "ren.environment.id": environmentId },
          },
          traces: Option.some({ url: `${memory}/traces`, headers: {} }),
          logs: Option.some({ url: `${memory}/logs`, headers: {} }),
          reportErrors: true,
          continueTraces: true,
        }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, keep))),
      ),
      Layer.provideMerge(Observability.layer("Info")),
    )
  }),
)

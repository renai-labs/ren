export * as BrainTelemetry from "./brain-telemetry.js"

import { EnvironmentTelemetry } from "@ren/brain/environment/telemetry"
import { Observability } from "@ren/schema/observability"
import { Telemetry } from "@ren/util/telemetry"
import { Effect, Layer, Option } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http"
import { Cell } from "./cell.js"
import { HostToken } from "./host-token.js"
import { RenAddress } from "./ren-address.js"

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const cell = yield* Cell.Info
    const url = cell.vars.REN_URL
    const signals = (cell.vars.REN_TELEMETRY ?? "").split(",")
    const target = (signal: "traces" | "logs") =>
      url && signals.includes(signal)
        ? Option.some<Telemetry.Target>({ url: `${url}/host/telemetry/v1/${signal}`, headers: {} })
        : Option.none<Telemetry.Target>()
    return Layer.mergeAll(
      Telemetry.layer({
        resource: { serviceName: "ren-brain", serviceVersion: cell.version, attributes: {} },
        traces: target("traces"),
        logs: target("logs"),
        reportErrors: true,
        continueTraces: true,
      }),
      Layer.effect(
        EnvironmentTelemetry.Service,
        Effect.gen(function* () {
          const http = yield* HttpClient.HttpClient
          return EnvironmentTelemetry.Service.of({
            forward: (drained) =>
              Effect.forEach(
                ["traces", "logs"] as const,
                (signal) =>
                  Option.match(target(signal), {
                    onNone: () => Effect.void,
                    onSome: (found) =>
                      Effect.forEach(
                        drained[signal],
                        (body) =>
                          http.execute(
                            HttpClientRequest.post(found.url).pipe(
                              HttpClientRequest.bodyText(body, "application/json"),
                            ),
                          ),
                        { discard: true },
                      ),
                  }),
                { discard: true },
              ).pipe(Effect.ignore),
          })
        }),
      ).pipe(Layer.provide(Telemetry.warnOnFailure)),
    ).pipe(
      Layer.provideMerge(Observability.layer("Info")),
      Layer.provide(
        Layer.effect(
          HttpClient.HttpClient,
          Effect.gen(function* () {
            const http = yield* HttpClient.HttpClient
            const token = yield* HostToken.Service
            return HttpClient.mapRequestEffect(http, (request) =>
              Effect.map(token.current, (current) =>
                HttpClientRequest.bearerToken(
                  request,
                  Option.getOrElse(current, () => ""),
                ),
              ),
            )
          }),
        ),
      ),
      Layer.provide(RenAddress.http),
      Layer.provide(FetchHttpClient.layer),
    )
  }),
)

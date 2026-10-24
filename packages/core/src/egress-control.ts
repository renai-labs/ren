export * as EgressControl from "./egress-control.js"

import { Config, Context, Duration, Effect, Layer, Schedule } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export interface Selector {
  readonly workload?: string
  readonly label?: string
  readonly login?: string
}

export interface Interface {
  readonly invalidate: (selector: Selector) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/EgressControl") {}

export const workloadPrefix = (workload: { readonly kind: string; readonly id: string }) =>
  `${workload.kind}:${workload.id}:`

export const layerNone = Layer.succeed(Service, Service.of({ invalidate: () => Effect.void }))

// oxlint-disable-next-line ren/no-comments -- Ren tells every egress copy to drop the answers it keeps (C40). The first call is awaited; a copy that does not answer is retried in the background, and its 30 s answer lifetime bounds the delay.
export const layerHttp = Layer.effect(
  Service,
  Effect.gen(function* () {
    const urls = yield* Config.String("EGRESS_CONTROL_URLS").pipe(
      Config.map((value) =>
        value
          .split(",")
          .map((url) => url.trim())
          .filter((url) => url.length > 0),
      ),
    )
    const http = yield* HttpClient.HttpClient
    const scope = yield* Effect.scope
    return Service.of({
      invalidate: Effect.fn("EgressControl.invalidate")(function* (selector: Selector) {
        yield* Effect.forEach(
          urls,
          (url) => {
            const send = HttpClientRequest.post(new URL("/egress/v1/invalidate", url)).pipe(
              HttpClientRequest.bodyJsonUnsafe(selector),
              http.execute,
              Effect.flatMap((response) =>
                response.status === 204 || response.status === 200
                  ? Effect.void
                  : Effect.fail(new Error(`Egress ${url} answered ${response.status} to an invalidate`)),
              ),
            )
            return send.pipe(
              Effect.catch(() =>
                send.pipe(
                  Effect.retry({ schedule: Schedule.exponential(Duration.millis(200)), times: 8 }),
                  Effect.catch((error) => Effect.logWarning(`Egress ${url} did not take an invalidate`, error)),
                  Effect.forkIn(scope),
                  Effect.asVoid,
                ),
              ),
            )
          },
          { concurrency: "unbounded", discard: true },
        )
      }),
    })
  }),
)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("EGRESS_CONTROL_URLS")), (urls) =>
    urls._tag === "Some" ? layerHttp : layerNone,
  ),
)

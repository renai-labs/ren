export * as RenInferenceProvider from "./provider.js"

import { Config, DateTime, Duration, Effect, Option, Redacted, Ref, Schedule } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import { Models } from "../models.js"
import { RenInference } from "../ren-inference.js"

export const id = "ren"

export const keyLifetime = Duration.hours(6)

export const endpoint = (
  catalog: Models.InferenceCatalog,
  options: { readonly baseUrl?: string } = {},
): Models.CatalogEndpoint => ({
  id,
  name: "Ren",
  protocol: "openai-chat",
  baseUrl: options.baseUrl ?? catalog.baseUrl,
  models: catalog.models,
})

const refreshEvery = Duration.seconds(30)

const answersWithin = Duration.seconds(10)

const trimmed = (url: string) => url.replace(/\/+$/u, "")

export const configured = Effect.map(
  Config.all([
    Config.option(Config.String("REN_INFERENCE_URL")),
    Config.option(Config.String("REN_INFERENCE_GATEWAY_URL")),
  ]),
  (found) => found.some(Option.isSome),
)

export const make = Effect.gen(function* () {
  const managed = yield* Config.option(Config.String("REN_INFERENCE_URL"))
  const root = trimmed(Option.isSome(managed) ? managed.value : yield* Config.String("REN_INFERENCE_GATEWAY_URL"))
  const gatewayKey = yield* Config.Redacted("REN_INFERENCE_GATEWAY_KEY")
  const brainRoot = trimmed(
    yield* Config.String("REN_INFERENCE_BRAIN_URL").pipe(
      Config.orElse(() => Config.String("REN_INFERENCE_GATEWAY_URL")),
      Config.withDefault(root),
    ),
  )
  const inference = yield* RenInference.Service
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const read = http
    .execute(
      HttpClientRequest.get(`${root}/v1/catalog`).pipe(HttpClientRequest.bearerToken(Redacted.value(gatewayKey))),
    )
    .pipe(
      Effect.flatMap(HttpClientResponse.schemaBodyJson(Models.InferenceCatalog)),
      Effect.timeout(answersWithin),
      Effect.map((catalog) => endpoint(catalog, { baseUrl: `${brainRoot}/v1` })),
    )
  const current = yield* Ref.make(Option.none<Models.CatalogEndpoint>())
  const load = read.pipe(
    Effect.tap((found) => Ref.set(current, Option.some(found))),
    Effect.tapError((error) =>
      Effect.logWarning("Ren's inference catalog could not be read; Ren keeps its last list", error),
    ),
  )
  yield* load.pipe(
    Effect.ignore,
    Effect.repeat(Schedule.spaced(refreshEvery)),
    Effect.withErrorReporting,
    Effect.forkScoped,
  )
  return {
    id,
    registration: { id, name: "Ren", protocol: "openai-chat", baseUrl: `${brainRoot}/v1`, catalog: "inference" },
    endpoint: Effect.gen(function* () {
      const found = yield* Ref.get(current)
      if (Option.isSome(found)) return found.value
      return yield* load.pipe(Effect.mapError((cause) => new Models.Unavailable({ cause })))
    }),
    key: Option.isSome(managed)
      ? (brainId, organizationId, spaceId) =>
          inference
            .grant(brainId, organizationId, spaceId)
            .pipe(Effect.mapError((cause) => new Models.Unavailable({ cause })))
      : () =>
          Effect.map(DateTime.now, (now) => ({ key: gatewayKey, expiresAt: DateTime.addDuration(now, keyLifetime) })),
  } satisfies Models.Provider
})

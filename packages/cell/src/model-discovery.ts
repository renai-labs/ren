export * as ModelDiscovery from "./model-discovery.js"

import { Models } from "@ren/schema/models"
import { ModelTypes } from "@ren/schema/model-types"
import { Duration, Effect, Option, Redacted, Schedule, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Inference } from "./inference.js"
import { ModelRefresh } from "./model-refresh.js"

const interval = Duration.seconds(30)

const answersWithin = Duration.seconds(10)

const apiUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/u, "")}/v1`

export const endpoints = Effect.fnUntraced(function* (
  catalog: Models.Catalog,
  baseUrl: string,
  keyFor: (endpointId: string) => Effect.Effect<Option.Option<Models.ApiKey>>,
) {
  return yield* Effect.forEach(catalog.endpoints, (endpoint) =>
    Effect.map(keyFor(endpoint.id), (apiKey) =>
      Option.map(apiKey, (found): Models.Endpoint => ({ ...endpoint, baseUrl: apiUrl(baseUrl), apiKey: found })),
    ),
  ).pipe(Effect.map((all) => all.flatMap((each) => (Option.isSome(each) ? [each.value] : []))))
})

const decode = HttpClientResponse.schemaBodyJson(Models.InferenceModelInfo)

const decodeSearch = HttpClientResponse.schemaBodyJson(ModelTypes.SearchInfo)

export const make = Effect.fn("ModelDiscovery.make")(function* (input: {
  readonly inference: Inference.Interface
  readonly keyFor: (endpointId: string) => Effect.Effect<Option.Option<Models.ApiKey>>
  readonly apply: (endpoints: ReadonlyArray<Models.Endpoint>, modelCatalogs: ModelTypes.Catalogs) => Effect.Effect<void>
}) {
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const reading = yield* Semaphore.make(1)
  const publishing = yield* Semaphore.make(1)
  const applied: { value: string | undefined } = { value: undefined }
  const publish = publishing.withPermit(
    Effect.gen(function* () {
      const baseUrl = yield* input.inference.baseUrl
      const catalog = yield* input.inference.catalog
      if (Option.isNone(baseUrl) || Option.isNone(catalog)) return
      const modelCatalogs = yield* input.inference.modelCatalogs
      const encoded = `${baseUrl.value}\n${JSON.stringify(catalog.value)}\n${JSON.stringify(modelCatalogs)}`
      if (encoded === applied.value) return
      yield* input.apply(yield* endpoints(catalog.value, baseUrl.value, input.keyFor), modelCatalogs)
      applied.value = encoded
    }),
  )
  const read = Effect.gen(function* () {
    const baseUrl = yield* input.inference.baseUrl
    if (Option.isNone(baseUrl)) return
    const key = yield* input.keyFor(ModelRefresh.anyEndpoint)
    if (Option.isNone(key)) return yield* Effect.logWarning("The brain has no model key; it keeps its model list")
    const get = (path: string) =>
      http.execute(
        HttpClientRequest.get(`${baseUrl.value.replace(/\/+$/u, "")}${path}`).pipe(
          HttpClientRequest.bearerToken(Redacted.value(key.value.key)),
        ),
      )
    yield* Effect.all(
      [
        Effect.gen(function* () {
          const info = yield* get("/model/info").pipe(Effect.flatMap(decode), Effect.timeout(answersWithin))
          yield* input.inference.saveCatalog(Models.fromInference(info), { baseUrl: baseUrl.value })
          yield* input.inference.saveModelCatalogs(ModelTypes.fromInference(info), { baseUrl: baseUrl.value })
          yield* publish
        }).pipe(Effect.catch((error) => Effect.logWarning("Model discovery failed; keeping the last catalogs", error))),
        Effect.gen(function* () {
          const search = yield* get("/v1/search/tools").pipe(
            Effect.flatMap(decodeSearch),
            Effect.timeout(answersWithin),
          )
          yield* input.inference.saveModelCatalogs(
            { search: ModelTypes.fromSearch(search) },
            { baseUrl: baseUrl.value },
          )
          yield* publish
        }).pipe(Effect.catch((error) => Effect.logWarning("Search discovery failed; keeping the last catalog", error))),
      ],
      { concurrency: "unbounded", discard: true },
    )
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("The model list could not be read; the brain keeps its last list", error),
    ),
    Effect.withSpan("ModelDiscovery.read"),
  )
  const refresh = reading.withPermit(read)
  yield* refresh.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.withErrorReporting, Effect.forkScoped)
  return { refresh }
})

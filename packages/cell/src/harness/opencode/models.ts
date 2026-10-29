export * as OpenCodeModels from "./models.js"

import { Models } from "@ren/schema/models"
import { Duration, Effect, Option, Redacted, Schedule, Semaphore } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http"
import type { Inference } from "../../inference.js"
import { ModelRefresh } from "../../model-refresh.js"
import type { Harness } from "../harness.js"

// oxlint-disable-next-line ren/no-comments -- HR14: the same interval as OpenCode's own provider discovery (`plugin/provider/local.ts`, 2.0.27).
const interval = Duration.seconds(30)

const answersWithin = Duration.seconds(10)

// oxlint-disable-next-line ren/no-comments -- OpenCode's clients add the API path to a base URL that ends in /v1; the inference URL is LiteLLM's root (spec §7).
const apiUrl = (baseUrl: string) => `${baseUrl.replace(/\/+$/u, "")}/v1`

export const endpoints = Effect.fnUntraced(function* (
  catalog: Models.Catalog,
  baseUrl: string,
  keyFor: Harness.Refresh,
) {
  return yield* Effect.forEach(catalog.endpoints, (endpoint) =>
    Effect.map(keyFor(endpoint.id), (apiKey) =>
      Option.map(apiKey, (found): Models.Endpoint => ({ ...endpoint, baseUrl: apiUrl(baseUrl), apiKey: found })),
    ),
  ).pipe(Effect.map((all) => all.flatMap((each) => (Option.isSome(each) ? [each.value] : []))))
})

const decode = HttpClientResponse.schemaBodyJson(Models.LiteLLMModelInfo)

// oxlint-disable-next-line ren/no-comments -- HR14, HR24: reads LiteLLM's /model/info with the brain's key, keeps the last list when the read fails, stores a changed list and hands it to OpenCode.
export const make = Effect.fnUntraced(function* (input: {
  readonly inference: Inference.Interface
  readonly keyFor: Harness.Refresh
  readonly apply: (endpoints: ReadonlyArray<Models.Endpoint>) => Effect.Effect<void>
}) {
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient)
  const reading = yield* Semaphore.make(1)
  const applied: { value: string | undefined } = { value: undefined }
  const read = Effect.gen(function* () {
    const baseUrl = yield* input.inference.baseUrl
    if (Option.isNone(baseUrl)) return
    const key = yield* input.keyFor(ModelRefresh.anyEndpoint)
    if (Option.isNone(key)) return yield* Effect.logWarning("The brain has no model key; it keeps its model list")
    const catalog = yield* http
      .execute(
        HttpClientRequest.get(`${baseUrl.value.replace(/\/+$/u, "")}/model/info`).pipe(
          HttpClientRequest.bearerToken(Redacted.value(key.value.key)),
        ),
      )
      .pipe(Effect.flatMap(decode), Effect.timeout(answersWithin), Effect.map(Models.fromLiteLLM))
    yield* input.inference.saveCatalog(catalog)
    const read = `${baseUrl.value}\n${JSON.stringify(catalog)}`
    if (read === applied.value) return
    yield* input.apply(yield* endpoints(catalog, baseUrl.value, input.keyFor))
    applied.value = read
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("The model list could not be read; the brain keeps its last list", error),
    ),
    Effect.withSpan("OpenCodeModels.read"),
  )
  const refresh = reading.withPermit(read)
  yield* refresh.pipe(Effect.repeat(Schedule.spaced(interval)), Effect.withErrorReporting, Effect.forkScoped)
  return { refresh }
})

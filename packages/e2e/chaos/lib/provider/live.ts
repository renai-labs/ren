export * as LiveModel from "./live.js"

import { Models } from "@ren/schema/models"
import { Redacted, Result, Schema, Struct } from "effect"

const ProviderConfig = Schema.Struct({
  package: Schema.optional(Schema.String),
  settings: Schema.optional(
    Schema.Struct({ baseURL: Schema.optional(Schema.String), apiKey: Schema.optional(Schema.String) }),
  ),
  models: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        name: Schema.optional(Schema.String),
        limit: Schema.optional(Schema.Struct({ context: Schema.Number, output: Schema.Number })),
      }),
    ),
  ),
})

const Source = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("document"),
    path: Schema.String,
    info: Schema.optional(Schema.Struct({ providers: Schema.optional(Schema.Record(Schema.String, ProviderConfig)) })),
  }),
  Schema.Struct({ type: Schema.String, path: Schema.optional(Schema.String) }),
])

const Sources = Schema.Array(Source)
type Sources = typeof Sources.Type

const protocols: ReadonlyArray<readonly [RegExp, Models.Protocol]> = [
  [/@ai-sdk\/anthropic$/, "anthropic-messages"],
  [/@ai-sdk\/openai$/, "openai-responses"],
  [/@ai-sdk\/openai-compatible$/, "openai-chat"],
]

interface Selected {
  readonly providerId: string
  readonly modelId: string
  readonly source: string
  readonly protocol: Models.Protocol
  readonly baseUrl: string
  readonly apiKey: Redacted.Redacted
  readonly limit: { readonly context: number; readonly output: number }
}

type Resolve = (reference: string) => string | undefined

const environmentReference: Resolve = (reference) => {
  if (process.env.CHAOS_LIVE_API_KEY) return process.env.CHAOS_LIVE_API_KEY
  const variable = /^\{env:([A-Z0-9_]+)\}$/i.exec(reference)?.[1]
  if (variable) return process.env[variable]
  return reference.startsWith("{file:") ? process.env["CHAOS_UNRESOLVED_FILE_REFERENCE"] : reference
}

const definition = (sources: Sources, providerId: string) =>
  sources
    .flatMap((source) => {
      if (source.type !== "document" || !("info" in source)) return []
      const provider = source.info?.providers?.[providerId]
      return provider ? [{ source: source.path, provider }] : []
    })
    .at(-1)

const selectedFrom = (
  found: { readonly source: string; readonly provider: typeof ProviderConfig.Type },
  providerId: string,
  modelId: string,
  key: Resolve,
): Result.Result<Selected, string> => {
  const model = found.provider.models?.[modelId]
  if (!model)
    return Result.fail(
      `Provider ${providerId} in ${found.source} does not list ${modelId}. No other model is selected.`,
    )
  const protocol = protocols.find((entry) => entry[0].test(found.provider.package ?? ""))?.[1]
  if (!protocol) return Result.fail(`Provider ${providerId} uses an unsupported package`)
  const baseUrl = found.provider.settings?.baseURL ?? ""
  const apiKey = key(found.provider.settings?.apiKey ?? "")
  if (!baseUrl || !apiKey)
    return Result.fail(`Provider ${providerId} needs a baseURL and a resolvable API key reference`)
  return Result.succeed({
    providerId,
    modelId,
    source: found.source,
    protocol,
    baseUrl,
    apiKey: Redacted.make(apiKey),
    limit: model.limit ?? { context: 200_000, output: 8_000 },
  })
}

const resolve = (
  sources: Sources,
  selection: string | undefined,
  key: Resolve = environmentReference,
): Result.Result<Selected, string> => {
  const slash = selection?.indexOf("/") ?? -1
  if (!selection || slash <= 0)
    return Result.fail(
      "Select one live model: set CHAOS_LIVE_MODEL to <provider>/<model>, for example ren/anthropic/claude-haiku-5-5.",
    )
  const providerId = selection.slice(0, slash)
  const found = definition(sources, providerId)
  if (!found) return Result.fail(`No configuration source defines provider ${providerId}`)
  return selectedFrom(found, providerId, selection.slice(slash + 1), key)
}

const load = async (): Promise<Result.Result<Sources, string>> => {
  const child = Bun.spawn(["opencode", "debug", "config"], {
    stdout: "pipe",
    stderr: "ignore",
    ...(process.env.CHAOS_LIVE_CONFIG_DIR && { cwd: process.env.CHAOS_LIVE_CONFIG_DIR }),
  })
  const output = await new Response(child.stdout).text()
  if ((await child.exited) !== 0) return Result.fail("opencode debug config failed")
  const decoded = Schema.decodeUnknownOption(Schema.fromJsonString(Sources))(output)
  return decoded._tag === "Some"
    ? Result.succeed(decoded.value)
    : Result.fail("opencode debug config printed an unknown shape")
}

export const access = (selected: Selected): Models.Access => ({
  endpoints: [
    {
      id: selected.providerId,
      protocol: selected.protocol,
      baseUrl: selected.baseUrl,
      apiKey: { key: selected.apiKey },
      models: [{ id: selected.modelId, name: selected.modelId, limit: selected.limit }],
    },
  ],
})

export const select = async (selection: string | undefined) => {
  const sources = await load()
  return Result.isFailure(sources) ? Result.fail(sources.failure) : resolve(sources.success, selection)
}

// oxlint-disable-next-line ren/no-comments -- HR15: a brain names a LiteLLM model by its provider and model key, read from /model/info, not by the name in an OpenCode config. A provider without /model/info keeps the selected names.
export const named = async (selected: Selected) => {
  const own = { access: access(selected), model: { endpointId: selected.providerId, modelId: selected.modelId } }
  const response = await fetch(`${selected.baseUrl.replace(/\/v1\/?$/u, "")}/model/info`, {
    headers: { authorization: `Bearer ${Redacted.value(selected.apiKey)}` },
  }).catch(() => undefined)
  if (!response?.ok) return own
  const catalog = Models.fromInference(Schema.decodeUnknownSync(Models.InferenceModelInfo)(await response.json()))
  const model = catalog.endpoints
    .flatMap((endpoint) =>
      endpoint.models.flatMap((entry) =>
        (entry.upstreamId ?? entry.id) === selected.modelId ? [{ endpointId: endpoint.id, modelId: entry.id }] : [],
      ),
    )
    .at(0)
  if (!model) throw new Error(`${selected.baseUrl} lists no ${selected.modelId} for the live key`)
  return {
    access: {
      endpoints: catalog.endpoints.map((endpoint) =>
        Struct.assign(endpoint, { baseUrl: selected.baseUrl, apiKey: { key: selected.apiKey } }),
      ),
    },
    model,
  }
}

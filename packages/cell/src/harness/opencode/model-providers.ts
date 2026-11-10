export * as ModelProviders from "./model-providers.js"

import type { ProviderEditor } from "@opencode/plugin/effect/provider"
import { Model } from "@opencode/core/model"
import { Variant } from "@opencode/core/variant"
import { Provider } from "@opencode/schema/provider"
import type { Models } from "@ren/schema/models"

const protocols = {
  "anthropic-messages": { canonical: Provider.ID.make("anthropic"), package: "@opencode/ai/providers/anthropic" },
  "openai-responses": { canonical: Provider.ID.make("openai"), package: "@opencode/ai/providers/openai" },
  "openai-chat": { package: "@opencode/ai/providers/openai-compatible" },
  "openai-images": { package: "@opencode/ai/providers/openai-compatible/images" },
  "openai-transcription": { package: "@opencode/ai/providers/openai-compatible" },
  "openai-decisions": { package: "@opencode/ai/providers/openai-compatible" },
  "openai-speech": { package: "@opencode/ai/providers/openai-compatible" },
  "openai-realtime": { package: "@opencode/ai/providers/openai-compatible" },
  "openai-video": { package: "@opencode/ai/providers/openai-compatible" },
} satisfies Record<Models.ModelProtocol, { readonly canonical?: Provider.ID; readonly package: string }>

export const apply = (editor: ProviderEditor, endpoints: ReadonlyArray<Models.Endpoint>) => {
  if (endpoints.length > 0)
    for (const record of editor.list())
      if (!endpoints.some((endpoint) => endpoint.id === record.provider.id)) editor.remove(record.provider.id)
  for (const endpoint of endpoints) {
    const protocol: { readonly canonical?: Provider.ID; readonly package: string } = protocols[endpoint.protocol]
    editor.update(endpoint.id, (provider) => {
      provider.activation = "enabled"
      if (endpoint.name) provider.name = endpoint.name
      provider.package = protocol.package
      provider.settings = { ...provider.settings, baseURL: endpoint.baseUrl, transport: "http" }
      if (protocol.canonical) provider.canonical = protocol.canonical
      if (endpoint.headers) provider.headers = { ...provider.headers, ...endpoint.headers }
    })
    const listed = new Set(endpoint.models.map((model) => model.id))
    for (const id of editor.get(endpoint.id)?.models.keys() ?? [])
      if (!listed.has(id)) editor.models.remove(endpoint.id, id)
    for (const model of endpoint.models) {
      // oxlint-disable-next-line ren/no-comments -- OpenCode calls a model with its own package before its provider's (core/src/model.ts:142).
      const own: { readonly canonical?: Provider.ID; readonly package: string } =
        protocols[model.protocol ?? endpoint.protocol]
      editor.models.update(endpoint.id, Model.ID.make(model.id), (info) => {
        info.modelID = Model.ID.make(model.upstreamId ?? model.id)
        info.package = model.protocol && own.package
        info.canonical = model.protocol && own.canonical
        if (model.name) info.name = model.name
        if (model.input) info.capabilities.input = [...model.input]
        if (model.limit) info.limit = { ...info.limit, ...model.limit }
        info.variants = [
          ...Variant.resolve(
            {
              ...Model.Info.default(Provider.ID.make(endpoint.id), Model.ID.make(model.id)),
              package: own.package,
              ...(model.limit && { limit: model.limit }),
            },
            // oxlint-disable-next-line ren/no-comments -- Ren's catalog is the only source of efforts, the same for every harness; OpenCode adds none of its own.
            model.efforts ? [{ type: "effort", values: model.efforts }] : [],
          ),
        ]
      })
    }
  }
}

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
} satisfies Record<Models.Protocol, { readonly canonical?: Provider.ID; readonly package: string }>

export const apply = (editor: ProviderEditor, endpoints: ReadonlyArray<Models.Endpoint>) => {
  for (const endpoint of endpoints) {
    const protocol: { readonly canonical?: Provider.ID; readonly package: string } = protocols[endpoint.protocol]
    editor.update(endpoint.id, (provider) => {
      provider.activation = "enabled"
      provider.package = protocol.package
      provider.settings = { ...provider.settings, baseURL: endpoint.baseUrl }
      if (protocol.canonical) provider.canonical = protocol.canonical
      if (endpoint.headers) provider.headers = { ...provider.headers, ...endpoint.headers }
    })
    for (const model of endpoint.models)
      editor.models.update(endpoint.id, model.id, (info) => {
        if (model.name) info.name = model.name
        if (model.limit) info.limit = { ...info.limit, ...model.limit }
        info.variants = [
          ...Variant.resolve(
            {
              ...Model.Info.default(Provider.ID.make(endpoint.id), Model.ID.make(model.id)),
              package: protocol.package,
              ...(model.limit && { limit: model.limit }),
            },
            model.efforts && [{ type: "effort", values: model.efforts }],
          ),
        ]
      })
  }
}

export * as OpenCodeSearch from "./search-provider.js"

import type { WebSearchEditor } from "@opencode/plugin/effect/websearch"
import { Effect, Ref } from "effect"
import { FetchHttpClient } from "effect/http"
import { ProviderHttp } from "../../provider-http.js"
import { InferenceSearch } from "../../search/inference.js"
import type { HarnessConfig } from "../config.js"
import type { Harness } from "../harness.js"

export const register = (
  editor: WebSearchEditor,
  input: { readonly current: Ref.Ref<HarnessConfig.Snapshot>; readonly keyFor: Harness.Refresh },
) => {
  for (const endpoint of Ref.getUnsafe(input.current).models)
    for (const service of endpoint.search ?? [])
      editor.add({
        id: `${encodeURIComponent(endpoint.id)}/${encodeURIComponent(service.id)}`,
        name: `${endpoint.name ?? endpoint.id}: ${service.name}`,
        execute: (args) =>
          InferenceSearch.search(endpoint, ProviderHttp.key(endpoint, input.keyFor), {
            query: args.query,
            providerID: service.id,
            headers: {},
          }).pipe(Effect.provide(FetchHttpClient.layer)),
      })
}

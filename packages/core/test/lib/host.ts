export * as Host from "./host.js"

import { ConfigProvider, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainHost } from "../../src/brain-host.js"
import type { Models } from "../../src/models.js"

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  Layer.fresh(BrainHost.layer).pipe(
    Layer.provide(models),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

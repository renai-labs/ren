export * as Host from "./host.js"

import { ConfigProvider, Layer } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainHost } from "../../src/brain-host.js"
import { Environments } from "../../src/environments.js"
import type { Models } from "../../src/models.js"

export const layerWith = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  environments: Layer.Layer<Environments.Service, E, R>,
) =>
  Layer.fresh(BrainHost.layer).pipe(
    Layer.provide(models),
    Layer.provide(environments),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, Environments.layerNone)

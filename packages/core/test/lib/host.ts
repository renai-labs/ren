export * as Host from "./host.js"

import { ConfigProvider, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainHost } from "../../src/brain-host.js"
import { Hands } from "../../src/hands.js"
import type { Models } from "../../src/models.js"

const noHands = Layer.succeed(
  Hands.Service,
  Hands.Service.of({
    bind: (_subject, environmentId) =>
      Effect.fail(new Hands.NotFound({ message: `Environment ${environmentId} is not available to this session` })),
    findDirectory: () => Effect.succeed(Option.none()),
    unbind: () => Effect.void,
    access: (subject) =>
      Effect.fail(new Hands.NotFound({ message: `Session ${subject.sessionId} has no environment` })),
    release: () => Effect.void,
  }),
)

export const layerWith = <E, R>(
  config: Record<string, string>,
  models: Layer.Layer<Models.Service>,
  hands: Layer.Layer<Hands.Service, E, R>,
) =>
  Layer.fresh(BrainHost.layer).pipe(
    Layer.provide(models),
    Layer.provide(hands),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  )

export const layer = (config: Record<string, string>, models: Layer.Layer<Models.Service>) =>
  layerWith(config, models, noHands)

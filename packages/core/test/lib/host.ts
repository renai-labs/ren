export * as Host from "./host.js"

import { ConfigProvider, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"
import { BrainHost } from "../../src/brain-host.js"
import { Environments } from "../../src/environments.js"
import type { Models } from "../../src/models.js"

const noEnvironments = Layer.succeed(
  Environments.Service,
  Environments.Service.of({
    bind: (_subject, environmentTemplateId) =>
      Effect.fail(
        new Environments.NotFound({
          message: `Environment template ${environmentTemplateId} is not available to this session`,
        }),
      ),
    findDirectory: () => Effect.succeed(Option.none()),
    unbind: () => Effect.void,
    access: (subject) =>
      Effect.fail(new Environments.NotFound({ message: `Session ${subject.sessionId} has no environment` })),
    release: () => Effect.void,
  }),
)

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
  layerWith(config, models, noEnvironments)

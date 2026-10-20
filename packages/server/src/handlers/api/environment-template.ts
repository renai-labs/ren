import { EnvironmentTemplates } from "@ren/core/environment-templates"
import { EnvironmentProvider } from "@ren/core/environment-provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const EnvironmentTemplateHandler = HttpApiBuilder.group(Api, "environment-template", (handlers) =>
  Effect.gen(function* () {
    const templates = yield* EnvironmentTemplates.Service
    return handlers
      .handle("environment-template.list", Primitive.list(templates.list))
      .handle("environment-template.get", Primitive.get(templates.get))
      .handle("environment-template.create", Primitive.create(templates.create))
      .handle("environment-template.update", Primitive.update(templates.update))
      .handle("environment-template.archive", Primitive.archive(templates.archive))
  }),
)

export const EnvironmentProviderHandler = HttpApiBuilder.group(Api, "environmentProvider", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* EnvironmentProvider.Registry
    return handlers.handle("environmentProvider.list", () =>
      Effect.succeed(registry.providers.map((provider) => provider.info)),
    )
  }),
)

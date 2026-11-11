import { BrainProvider } from "@ren/core/brain-provider"
import { MachineTemplates } from "@ren/core/machine-templates"
import { HandProvider } from "@ren/core/hand-provider"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const MachineTemplateHandler = HttpApiBuilder.group(Api, "environment-template", (handlers) =>
  Effect.gen(function* () {
    const templates = yield* MachineTemplates.Service
    return handlers
      .handle("environment-template.list", Primitive.list(templates.list))
      .handle("environment-template.get", Primitive.get(templates.get))
      .handle("environment-template.create", Primitive.create(templates.create))
      .handle("environment-template.update", Primitive.update(templates.update))
      .handle("environment-template.archive", Primitive.archive(templates.archive))
      .handle("environment-template.retryBuild", Primitive.action(templates.retryBuild))
      .handle("environment-template.affectedSpaces", Primitive.action(templates.affectedSpaces))
  }),
)

export const MachineProviderHandler = HttpApiBuilder.group(Api, "environmentProvider", (handlers) =>
  Effect.gen(function* () {
    const registry = yield* HandProvider.Registry
    const brains = yield* BrainProvider.Registry
    return handlers
      .handle("environmentProvider.list", () => Effect.succeed(registry.providers.map((provider) => provider.info)))
      .handle("environmentProvider.brains", () => Effect.succeed(brains.providers.map((provider) => provider.info)))
  }),
)

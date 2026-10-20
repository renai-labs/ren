import { SpaceEnvironmentTemplate } from "@ren/core/space/environment-template"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { Api } from "../../api.js"
import { Primitive } from "../../primitive.js"

export const SpaceEnvironmentTemplateHandler = HttpApiBuilder.group(Api, "space-environment-template", (handlers) =>
  Effect.gen(function* () {
    const spaceEnvironmentTemplates = yield* SpaceEnvironmentTemplate.Service
    return handlers
      .handle("space-environment-template.list", Primitive.list(spaceEnvironmentTemplates.list))
      .handle("space-environment-template.create", Primitive.create(spaceEnvironmentTemplates.create))
      .handle("space-environment-template.archive", Primitive.archive(spaceEnvironmentTemplates.archive))
  }),
)

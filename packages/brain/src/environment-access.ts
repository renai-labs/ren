export * as EnvironmentAccess from "./environment-access.js"

import { Environment } from "@ren/schema/environment"
import { Context, Effect, Layer, Schema } from "effect"

export class NotFound extends Schema.TaggedError<NotFound>()("EnvironmentAccess.NotFound", {
  environmentId: Environment.ID,
}) {}

export interface Interface {
  readonly open: (id: Environment.ID) => Effect.Effect<Environment.Access, NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/brain/EnvironmentAccess") {}

export const layerFixed = (accesses: ReadonlyArray<Environment.Access>) =>
  Layer.succeed(
    Service,
    Service.of({
      open: (id) => {
        const access = accesses.find((candidate) => candidate.environmentId === id)
        return access ? Effect.succeed(access) : Effect.fail(new NotFound({ environmentId: id }))
      },
    }),
  )

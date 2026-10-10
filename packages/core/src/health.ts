export * as Health from "./health.js"

import { Health } from "@ren/schema/health"
import { Version } from "@ren/util/version"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly check: () => Effect.Effect<Health.Info>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Health") {}

export const layer = Layer.succeed(
  Service,
  Service.of({
    check: Effect.fn("Health.check")(function* () {
      return { status: "ok", version: Version.current } satisfies Health.Info
    }),
  }),
)

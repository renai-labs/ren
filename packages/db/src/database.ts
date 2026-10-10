export * as Database from "./database.js"

import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly db: Effect.Success<ReturnType<typeof makeWithDefaults>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/db/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* makeWithDefaults()
    return Service.of({ db })
  }),
)

export * as Database from "./database.js"
export * as Schema from "./auth.sql.js"

import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import { Context, Effect, Layer } from "effect"
import { authRelations } from "./auth.sql.js"

const make = makeWithDefaults({ relations: authRelations })

export interface Interface {
  readonly db: Effect.Success<typeof make>
}

export class Service extends Context.Service<Service, Interface>()("@ren/db/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* make
    return Service.of({ db })
  }),
)

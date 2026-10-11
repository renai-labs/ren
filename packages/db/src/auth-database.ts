export * as AuthDatabase from "./auth-database.js"
export * as Schema from "./auth.sql.js"

import { SQL } from "bun"
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql/postgres"
import { Config, Context, Effect, Layer, Redacted } from "effect"
import { authRelations } from "./auth.sql.js"

export interface Interface {
  readonly db: BunSQLDatabase<typeof authRelations>
}

export class Service extends Context.Service<Service, Interface>()("@ren/db/AuthDatabase") {}

export const make = (url: Redacted.Redacted) =>
  Layer.effect(
    Service,
    Effect.acquireRelease(
      Effect.sync(() => new SQL(Redacted.value(url))),
      (client) => Effect.promise(() => client.close()),
    ).pipe(Effect.map((client) => Service.of({ db: drizzle({ client, relations: authRelations }) }))),
  )

export const layer = Layer.unwrap(
  Effect.gen(function* () {
    return make(yield* Config.Redacted("DATABASE_URL"))
  }),
)

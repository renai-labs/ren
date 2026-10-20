export * as Database from "./database.js"
export * as Schema from "./schema.js"

import { EffectDrizzleQueryError } from "drizzle-orm/effect-core"
import { makeWithDefaults } from "drizzle-orm/effect-postgres"
import { Context, Effect, Layer } from "effect"
import { SqlError } from "effect/sql/SqlError"
import { authRelations } from "./auth.sql.js"
import { environmentTemplateRelations } from "./environment.sql.js"
import { spaceRelations } from "./space.sql.js"
import { spaceEnvironmentTemplateRelations } from "./space-environment-template.sql.js"

const make = makeWithDefaults({
  relations: {
    ...spaceRelations,
    ...authRelations,
    ...environmentTemplateRelations,
    ...spaceEnvironmentTemplateRelations,
  },
})

type Client = Effect.Success<typeof make>

export type Transaction = Parameters<Parameters<Client["transaction"]>[0]>[0]

export interface Interface {
  readonly db: Client
  readonly transaction: <A, E, R>(
    body: (transaction: Transaction) => Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, Exclude<E, SqlError | EffectDrizzleQueryError>, R>
}

export class Service extends Context.Service<Service, Interface>()("@ren/db/Database") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const db = yield* make
    return Service.of({
      db,
      transaction: (body) =>
        db
          .transaction(body)
          .pipe(
            Effect.catchIf(
              (error): error is SqlError | EffectDrizzleQueryError =>
                error instanceof SqlError || error instanceof EffectDrizzleQueryError,
              Effect.die,
              Effect.fail,
            ),
          ),
    })
  }),
)

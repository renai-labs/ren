export * as ProviderCheck from "./provider-check.js"

import { Database } from "@ren/db/database"
import { and, isNotNull, isNull } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { BrainProvider } from "./brain-provider.js"
import { EnvironmentProvider } from "./environment-provider.js"

export class Missing extends Schema.TaggedError<Missing>()("ProviderCheck.Missing", { message: Schema.String }) {}

// oxlint-disable-next-line ren/no-comments -- EN24, chaos row 40: Ren does not start when a space or a template names a provider that this deployment does not register; the error lists the ones it has.
export const run = Effect.gen(function* () {
  const database = yield* Database.Service
  const brains = yield* BrainProvider.Registry
  const environments = yield* EnvironmentProvider.Registry
  const spaces = yield* database.db
    .selectDistinct({ provider: Database.Schema.space.brain_provider })
    .from(Database.Schema.space)
    .where(and(isNull(Database.Schema.space.archived_at), isNotNull(Database.Schema.space.brain_provider)))
    .pipe(Effect.orDie)
  const templates = yield* database.db
    .selectDistinct({ provider: Database.Schema.environment_template.provider })
    .from(Database.Schema.environment_template)
    .where(isNull(Database.Schema.environment_template.archived_at))
    .pipe(Effect.orDie)
  const ids = (registry: typeof brains) => registry.providers.map((provider) => provider.info.id).join(", ") || "none"
  const unknownBrains = spaces.flatMap((row) =>
    row.provider && Option.isNone(brains.get(row.provider)) ? [row.provider] : [],
  )
  const unknownHands = templates.flatMap((row) => (Option.isNone(environments.get(row.provider)) ? [row.provider] : []))
  if (unknownBrains.length > 0)
    return yield* new Missing({
      message: `Spaces name the brain providers ${unknownBrains.join(", ")}, which this Ren does not register; it has ${ids(brains)}`,
    })
  if (unknownHands.length > 0)
    return yield* new Missing({
      message: `Environment templates name the providers ${unknownHands.join(", ")}, which this Ren does not register; it has ${ids(environments)}`,
    })
})

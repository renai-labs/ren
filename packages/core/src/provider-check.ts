export * as ProviderCheck from "./provider-check.js"

import { Database } from "@ren/db/database"
import { isNotNull, isNull } from "drizzle-orm"
import { Effect, Option, Schema } from "effect"
import { BrainProvider } from "./brain-provider.js"
import { EnvironmentProvider } from "./environment-provider.js"
import type { MachineProvider } from "./machine-provider.js"

export class Missing extends Schema.TaggedError<Missing>()("ProviderCheck.Missing", { message: Schema.String }) {}

// oxlint-disable-next-line ren/no-comments -- Ren does not start when a brain runs on a provider, or a template names one, that this deployment does not register; the error lists the ones it has.
export const run = Effect.gen(function* () {
  const database = yield* Database.Service
  const brainProviders = yield* BrainProvider.Registry
  const handProviders = yield* EnvironmentProvider.Registry
  const brains = yield* database.db
    .selectDistinct({ provider: Database.Schema.brain.provider })
    .from(Database.Schema.brain)
    .where(isNotNull(Database.Schema.brain.provider))
    .pipe(Effect.orDie)
  const templates = yield* database.db
    .selectDistinct({ provider: Database.Schema.environment_template.provider })
    .from(Database.Schema.environment_template)
    .where(isNull(Database.Schema.environment_template.archived_at))
    .pipe(Effect.orDie)
  const unknown = (registry: MachineProvider.Registry, rows: ReadonlyArray<{ readonly provider: string | null }>) =>
    rows.flatMap((row) => (row.provider && Option.isNone(registry.get(row.provider)) ? [row.provider] : []))
  const has = (registry: MachineProvider.Registry) =>
    registry.providers.map((provider) => provider.info.id).join(", ") || "none"
  const unknownBrains = unknown(brainProviders, brains)
  if (unknownBrains.length > 0)
    return yield* new Missing({
      message: `Brains run on the providers ${unknownBrains.join(", ")}, which this Ren does not register; it has ${has(brainProviders)}`,
    })
  const unknownHands = unknown(handProviders, templates)
  if (unknownHands.length > 0)
    return yield* new Missing({
      message: `Environment templates name the providers ${unknownHands.join(", ")}, which this Ren does not register; it has ${has(handProviders)}`,
    })
})

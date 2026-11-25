export * as ChaosModels from "./models.js"

import { Models } from "@ren/core/models"
import { Brain } from "@ren/schema/brain"
import { Config, Effect, Layer, Schema } from "effect"

const File = Schema.toCodecJson(
  Schema.Struct({ fallback: Models.Access, brains: Schema.Record(Brain.ID, Models.Access) }),
)

export type Grants = typeof File.Type

export const fileVariable = "CHAOS_MODELS_FILE"

export const write = (path: string, grants: Grants) => Bun.write(path, JSON.stringify(Schema.encodeSync(File)(grants)))

export const layer = Layer.effect(
  Models.Service,
  Effect.gen(function* () {
    const path = yield* Config.String(fileVariable)
    const read = Effect.promise(() => Bun.file(path).json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(File)),
      Effect.orDie,
    )
    return Models.Service.of({
      forget: () => Effect.void,
      catalog: () => Effect.map(read, (grants) => Models.catalog(grants.fallback)),
      providers: () => Effect.map(read, (grants) => Models.registrations(Models.catalog(grants.fallback))),
      baseUrls: Effect.map(read, (grants) => grants.fallback.endpoints.map((endpoint) => endpoint.baseUrl)),
      grant: (brainId) => Effect.map(read, (grants) => grants.brains[brainId] ?? grants.fallback),
    })
  }),
)

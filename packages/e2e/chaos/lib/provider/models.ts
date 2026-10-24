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
      revision: Effect.succeed("test"),
      catalog: () => Effect.map(read, (grants) => Models.catalog(grants.fallback)),
      grant: (brainId) => Effect.map(read, (grants) => grants.brains[brainId] ?? grants.fallback),
    })
  }),
)

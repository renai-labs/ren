export * as ChaosHands from "./hands.js"

import { HandProvider } from "@ren/core/hand-provider"
import { Environment } from "@ren/schema/environment"
import { Config, Effect, Schema } from "effect"

const File = Schema.Record(Schema.String, Schema.Struct({ url: Schema.String, generation: Schema.Int }))

export const fileVariable = "CHAOS_HANDS_FILE"

export const providerId = HandProvider.ID.make("chaos")

const provider = Effect.gen(function* () {
  const path = yield* Config.String(fileVariable)
  const read = Effect.promise(() => Bun.file(path).json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(File)),
    Effect.orDie,
  )
  return HandProvider.make({
    id: providerId,
    title: "Chaos",
    description: "The chaos lane’s containers, behind its fault proxies.",
    config: Schema.Struct({}),
    binding: Schema.Struct({ environmentId: Environment.ID, generation: Schema.Int }),
    provision: (input) =>
      Effect.map(read, (file) => ({
        environmentId: input.environmentId,
        generation: file[input.environmentId]?.generation ?? 0,
      })),
    connect: (binding) =>
      Effect.flatMap(read, (file) => {
        const entry = file[binding.environmentId]
        return entry && entry.generation === binding.generation
          ? Effect.succeed({ url: new URL(entry.url) })
          : Effect.fail(
              new HandProvider.Gone({ message: `The chaos container of ${binding.environmentId} was replaced` }),
            )
      }),
    destroy: () => Effect.void,
  })
})

export const providers = [provider]

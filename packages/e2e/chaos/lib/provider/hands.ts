export * as ChaosHands from "./hands.js"

import { HandProvider } from "@ren/core/hand-provider"
import { Environment } from "@ren/schema/environment"
import { Config, Effect, Schema } from "effect"

const File = Schema.Record(
  Schema.String,
  Schema.Struct({ url: Schema.String, workspace: Schema.String, generation: Schema.Int }),
)

export const fileVariable = "CHAOS_HANDS_FILE"

const ids = { full: "chaos", files: "chaos-files" } as const

export const providerId = (capabilities: ReadonlyArray<Environment.Capability> | undefined) =>
  capabilities && !capabilities.includes("processes") ? ids.files : ids.full

const make = (id: string, capabilities: ReadonlyArray<Environment.Capability>) =>
  Effect.gen(function* () {
    const path = yield* Config.String(fileVariable)
    const read = Effect.promise(() => Bun.file(path).json()).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(File)),
      Effect.orDie,
    )
    return HandProvider.make({
      id,
      title: "Chaos",
      description: "The chaos lane’s containers, behind its fault proxies.",
      capabilities,
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
            ? Effect.succeed({ url: entry.url, workspace: entry.workspace })
            : Effect.fail(
                new HandProvider.Gone({ message: `The chaos container of ${binding.environmentId} was replaced` }),
              )
        }),
      destroy: () => Effect.void,
    })
  })

export const providers = [make(ids.full, ["files", "processes"]), make(ids.files, ["files"])]

export * as ChaosEnvironments from "./environments.js"

import { EnvironmentProvider } from "@ren/core/environment-provider"
import { MachineProvider } from "@ren/core/machine-provider"
import { EnvironmentTemplate } from "@ren/schema/environment-template"
import { Config, Effect, Schema } from "effect"

const File = Schema.Record(Schema.String, Schema.Struct({ url: Schema.String, generation: Schema.Int }))

export const fileVariable = "CHAOS_ENVIRONMENTS_FILE"

export const providerId = EnvironmentProvider.ID.make("chaos")

const provider = Effect.gen(function* () {
  const path = yield* Config.String(fileVariable)
  const read = Effect.promise(() => Bun.file(path).json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(File)),
    Effect.orDie,
  )
  return MachineProvider.make({
    id: providerId,
    title: "Chaos",
    description: "The chaos lane’s containers, behind its fault proxies.",
    canEgress: false,
    canMount: false,
    canSample: false,
    config: Schema.Struct({ environmentTemplateId: EnvironmentTemplate.ID }),
    binding: Schema.Struct({ environmentTemplateId: EnvironmentTemplate.ID, generation: Schema.Int }),
    create: (input) =>
      Effect.flatMap(read, (file) => {
        const entry = file[input.config.environmentTemplateId]
        return entry
          ? Effect.succeed({
              binding: { environmentTemplateId: input.config.environmentTemplateId, generation: entry.generation },
              url: entry.url,
            })
          : Effect.fail(
              new MachineProvider.Failed({ message: `No chaos container of ${input.config.environmentTemplateId}` }),
            )
      }),
    connect: (binding) =>
      Effect.flatMap(read, (file) => {
        const entry = file[binding.environmentTemplateId]
        return entry && entry.generation === binding.generation
          ? Effect.succeed({ url: entry.url })
          : Effect.fail(
              new MachineProvider.Gone({
                message: `The chaos container of ${binding.environmentTemplateId} was replaced`,
              }),
            )
      }),
    destroy: () => Effect.void,
  })
})

export const providers = [provider]

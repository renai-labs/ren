export * as ChaosEnvironments from "./environments.js"

import { EnvironmentProvider } from "@ren/core/environment-provider"
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
  return EnvironmentProvider.make({
    id: providerId,
    title: "Chaos",
    description: "The chaos lane’s containers, behind its fault proxies.",
    egress: false,
    config: Schema.Struct({}),
    binding: Schema.Struct({ environmentTemplateId: EnvironmentTemplate.ID, generation: Schema.Int }),
    provision: (input) =>
      Effect.map(read, (file) => ({
        environmentTemplateId: input.environmentTemplateId,
        generation: file[input.environmentTemplateId]?.generation ?? 0,
      })),
    connect: (binding) =>
      Effect.flatMap(read, (file) => {
        const entry = file[binding.environmentTemplateId]
        return entry && entry.generation === binding.generation
          ? Effect.succeed({ url: new URL(entry.url) })
          : Effect.fail(
              new EnvironmentProvider.Gone({
                message: `The chaos container of ${binding.environmentTemplateId} was replaced`,
              }),
            )
      }),
    destroy: () => Effect.void,
  })
})

export const providers = [provider]

export * as ArtifactProvider from "./artifact-provider.js"

import type { Artifact } from "@ren/schema/artifact"
import { Context, Effect, Option, Schema } from "effect"

export class Failed extends Schema.TaggedError<Failed>()("ArtifactProvider.Failed", { message: Schema.String }) {}

interface DeployInput<Binding> {
  readonly artifactId: Artifact.ID
  readonly deploymentId: Artifact.DeploymentID
  readonly config: Artifact.Config
  readonly files: Artifact.Files
  readonly previous: Option.Option<Binding>
}

interface Deployed<Binding> {
  readonly binding: Binding
  readonly url: string
}

interface Definition<Binding> {
  readonly id: Artifact.ProviderID
  readonly binding: Schema.Codec<Binding, unknown>
  readonly deploy: (input: DeployInput<Binding>) => Effect.Effect<Deployed<Binding>, Failed>
  readonly stop: (artifactId: Artifact.ID, binding: Option.Option<Binding>) => Effect.Effect<void, Failed>
}

export interface Interface {
  readonly id: Artifact.ProviderID
  readonly deploy: (input: DeployInput<Schema.Json>) => Effect.Effect<Deployed<Schema.Json>, Failed>
  readonly stop: (artifactId: Artifact.ID, binding: Option.Option<Schema.Json>) => Effect.Effect<void, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ArtifactProvider") {}

export const make = <Binding>(definition: Definition<Binding>): Interface => {
  const binding = Schema.toCodecJson(definition.binding)
  const stored = (value: Schema.Json) => Schema.decodeUnknownEffect(binding)(value).pipe(Effect.orDie)
  return {
    id: definition.id,
    deploy: Effect.fnUntraced(function* (input) {
      const deployed = yield* definition.deploy({
        ...input,
        previous: yield* Effect.transposeOption(Option.map(input.previous, stored)),
      })
      return {
        binding: yield* Schema.encodeEffect(binding)(deployed.binding).pipe(Effect.orDie),
        url: deployed.url,
      }
    }),
    stop: (artifactId, value) =>
      Effect.transposeOption(Option.map(value, stored)).pipe(
        Effect.flatMap((binding) => definition.stop(artifactId, binding)),
      ),
  }
}

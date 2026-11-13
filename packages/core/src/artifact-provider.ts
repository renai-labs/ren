export * as ArtifactProvider from "./artifact-provider.js"

import type { Artifact } from "@ren/schema/artifact"
import { Context, Effect, Option, Schema } from "effect"

// oxlint-disable-next-line ren/no-comments -- retryable says if the same call can succeed later: Ren tries a retryable failure again and ends the run as failed on any other.
export class Failed extends Schema.TaggedError<Failed>()("ArtifactProvider.Failed", {
  message: Schema.String,
  retryable: Schema.Boolean,
}) {}

// oxlint-disable-next-line ren/no-comments -- remote is the provider's state that Ren keeps on the artifact row. save writes it before each remote change, so the next call can recover; it fails as retryable when another run saved first.
interface DeployInput<Remote> {
  readonly artifactId: Artifact.ID
  readonly deploymentId: Artifact.DeploymentID
  readonly config: Artifact.Config
  readonly archive: string
  readonly remote: Option.Option<Remote>
  readonly save: (remote: Remote) => Effect.Effect<void, Failed>
}

interface Deployed<Remote> {
  readonly remote: Remote
  readonly url: string
}

interface Definition<Remote> {
  readonly id: Artifact.ProviderID
  readonly remote: Schema.Codec<Remote, unknown>
  readonly deploy: (input: DeployInput<Remote>) => Effect.Effect<Deployed<Remote>, Failed>
  readonly stop: (
    artifactId: Artifact.ID,
    remote: Option.Option<Remote>,
    save: (remote: Remote) => Effect.Effect<void, Failed>,
  ) => Effect.Effect<void, Failed>
}

export interface Interface {
  readonly id: Artifact.ProviderID
  readonly deploy: (input: DeployInput<Schema.Json>) => Effect.Effect<Deployed<Schema.Json>, Failed>
  readonly stop: (
    artifactId: Artifact.ID,
    remote: Option.Option<Schema.Json>,
    save: (remote: Schema.Json) => Effect.Effect<void, Failed>,
  ) => Effect.Effect<void, Failed>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ArtifactProvider") {}

export const make = <Remote>(definition: Definition<Remote>): Interface => {
  const codec = Schema.toCodecJson(definition.remote)
  const stored = (value: Option.Option<Schema.Json>) =>
    Effect.transposeOption(Option.map(value, (json) => Schema.decodeUnknownEffect(codec)(json).pipe(Effect.orDie)))
  const encoded = (remote: Remote) => Schema.encodeEffect(codec)(remote).pipe(Effect.orDie)
  const saver = (save: (remote: Schema.Json) => Effect.Effect<void, Failed>) => (remote: Remote) =>
    encoded(remote).pipe(Effect.flatMap(save))
  return {
    id: definition.id,
    deploy: Effect.fnUntraced(function* (input) {
      const deployed = yield* definition.deploy({
        ...input,
        remote: yield* stored(input.remote),
        save: saver(input.save),
      })
      return { remote: yield* encoded(deployed.remote), url: deployed.url }
    }),
    stop: (artifactId, remote, save) =>
      stored(remote).pipe(Effect.flatMap((decoded) => definition.stop(artifactId, decoded, saver(save)))),
  }
}

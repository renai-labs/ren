export * as CredentialEnv from "./credential-env.js"

import { Context, Effect, Layer, Option, Ref } from "effect"

export interface Interface {
  readonly current: Effect.Effect<Readonly<Record<string, string>>>
  readonly hash: Effect.Effect<Option.Option<string>>
  readonly apply: (hash: string, variables: Readonly<Record<string, string>>) => Effect.Effect<void>
  readonly turnEnded: Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/CredentialEnv") {}

interface State {
  readonly applied: Readonly<Record<string, string>>
  readonly wanted: Readonly<Record<string, string>>
  readonly hash: Option.Option<string>
}

// oxlint-disable-next-line ren/no-comments -- C47: a placeholder holds no secret and never changes for a label, so an addition applies at once, also in a running turn (after the person connects a key, a script in that turn sees it). A removal waits for the turn end.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<State>({ applied: {}, wanted: {}, hash: Option.none() })
    return Service.of({
      current: Effect.map(Ref.get(state), (found) => found.applied),
      hash: Effect.map(Ref.get(state), (found) => found.hash),
      apply: (hash, variables) =>
        Ref.update(state, (found) => ({
          applied: { ...found.applied, ...variables },
          wanted: variables,
          hash: Option.some(hash),
        })),
      turnEnded: Ref.update(state, (found) => ({ ...found, applied: found.wanted })),
    })
  }),
)

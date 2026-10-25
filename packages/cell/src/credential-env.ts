export * as CredentialEnv from "./credential-env.js"

import { Context, Effect, Layer, Ref } from "effect"

export interface Interface {
  readonly current: Effect.Effect<Readonly<Record<string, string>>>
  readonly apply: (variables: Readonly<Record<string, string>>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/CredentialEnv") {}

// oxlint-disable-next-line ren/no-comments -- HR18: the env vars of each pull apply at once, a removal too. A process reads them when it starts, so a running one keeps its copy.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<Readonly<Record<string, string>>>({})
    return Service.of({ current: Ref.get(state), apply: (variables) => Ref.set(state, variables) })
  }),
)

export * as CredentialEnv from "./credential-env.js"

import type { HandConnections } from "@ren/brain/hand/connections"
import { Context, Effect, Layer, Ref } from "effect"

export interface Interface {
  readonly current: Effect.Effect<HandConnections.Env>
  readonly apply: (env: HandConnections.Env) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/cell/CredentialEnv") {}

// oxlint-disable-next-line ren/no-comments -- HR18: the env vars of each pull apply at once, a removal too. A process reads them when it starts, so a running one keeps its copy.
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* Ref.make<HandConnections.Env>({ variables: {}, placeholders: {} })
    return Service.of({ current: Ref.get(state), apply: (env) => Ref.set(state, env) })
  }),
)

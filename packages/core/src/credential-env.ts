export * as CredentialEnv from "./credential-env.js"

import type { Workload } from "@ren/schema/workload"
import { Context, Effect, Layer, Option } from "effect"
import { Credentials } from "./credentials.js"

export interface Interface {
  readonly of: (workload: Workload.Info) => Effect.Effect<Readonly<Record<string, string>>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/CredentialEnv") {}

export const layerNone = Layer.succeed(Service, Service.of({ of: () => Effect.succeed({}) }))

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const credentials = yield* Credentials.Service
    return Service.of({
      of: Effect.fn("CredentialEnv.of")(function* (workload: Workload.Info) {
        const scope = yield* credentials.scopeOf(workload)
        if (Option.isNone(scope)) return {}
        return yield* credentials.environment(scope.value)
      }),
    })
  }),
)

export const hash = Effect.fn("CredentialEnv.hash")(function* (variables: Readonly<Record<string, string>>) {
  const content = JSON.stringify(
    Object.keys(variables)
      .toSorted()
      .map((name) => [name, variables[name]]),
  )
  const digest = yield* Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
})

export * as SandboxEgress from "./sandbox-egress.js"

import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Config, Context, Effect, Layer, Option } from "effect"
import { CredentialCallers } from "./credential-callers.js"
import { EgressControl } from "./egress-control.js"
import type { SandboxProvider } from "./sandbox-provider.js"

export interface Interface {
  readonly proxyFor: (brain: {
    readonly brainId: Brain.ID
    readonly generation: number
    readonly organizationId: Auth.OrganizationID
  }) => Effect.Effect<Option.Option<SandboxProvider.Proxy>>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SandboxEgress") {}

export const layerNone = Layer.succeed(Service, Service.of({ proxyFor: () => Effect.succeedNone }))

// oxlint-disable-next-line ren/no-comments -- A brain's sandbox sends all its traffic through the egress with a proxy login of its generation (C2). A resume reuses the login; a new generation gets a new one, and the old logins are revoked and their connections closed at once (C40, §8 Replace).
export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const address = yield* Config.String("EGRESS_PROXY_ADDRESS")
    const caFile = yield* Config.option(Config.String("EGRESS_CA_FILE"))
    const ca = yield* Option.match(caFile, {
      onNone: () => Effect.succeedNone,
      onSome: (path) =>
        Effect.map(
          Effect.promise(() => Bun.file(path).text()),
          Option.some,
        ),
    })
    const callers = yield* CredentialCallers.Service
    const control = yield* EgressControl.Service
    return Service.of({
      proxyFor: Effect.fn("SandboxEgress.proxyFor")(function* (brain) {
        const caller = {
          workload: { kind: "brain" as const, id: brain.brainId, generation: brain.generation },
          organizationId: brain.organizationId,
        }
        const kept = yield* callers.placement(caller)
        const placement = Option.isSome(kept)
          ? kept.value
          : yield* Effect.gen(function* () {
              const revoked = yield* callers.revoke({ kind: "brain", id: brain.brainId })
              yield* Effect.forEach(revoked.logins, (login) => control.invalidate({ login }), { discard: true })
              return yield* callers.issue(caller, "ProxyLogin")
            })
        if (placement.kind !== "ProxyLogin") return Option.none()
        return Option.some({ address, username: placement.username, password: placement.password, ca })
      }),
    })
  }),
)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("EGRESS_PROXY_ADDRESS")), (address) =>
    Option.isSome(address) ? layer : layerNone,
  ),
)

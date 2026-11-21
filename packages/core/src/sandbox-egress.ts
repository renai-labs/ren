export * as SandboxEgress from "./sandbox-egress.js"

import { Auth } from "@ren/schema/auth"
import type { Workload } from "@ren/schema/workload"
import { Config, Context, Effect, Layer, Option, Redacted } from "effect"
import { CredentialCallers } from "./credential-callers.js"
import { EgressControl } from "./egress-control.js"
import { Envelope } from "./envelope.js"
import type { MachineProvider } from "./machine-provider.js"

export interface Interface {
  readonly proxyFor: (machine: {
    readonly workload: Workload.Info
    readonly organizationId: Auth.OrganizationID
  }) => Effect.Effect<Option.Option<MachineProvider.Proxy>>
  readonly retire: (workload: Pick<Workload.Info, "kind" | "id">) => Effect.Effect<void>
  readonly enabled: boolean
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/SandboxEgress") {}

export const layerNone = Layer.succeed(
  Service,
  Service.of({ proxyFor: () => Effect.succeedNone, retire: () => Effect.void, enabled: false }),
)

// oxlint-disable-next-line ren/no-comments -- A machine, a brain's or a remote hand's, sends all its traffic through the egress with a proxy login of its generation (C2). A resume reuses the login; a replace retires it at once, so a sandbox whose destroy failed gets nothing while the next one waits (C40, §8 Replace).
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
    const envelope = yield* Envelope.Service
    // oxlint-disable-next-line ren/no-comments -- Every proxy login is sealed; without a key every create would fail at use and the brain would wait in creating with no failure (M3).
    yield* envelope
      .seal(Redacted.make("ren"), {
        organizationId: Auth.OrganizationID.make("org_ren"),
        kind: "credential_caller",
        id: "startup",
      })
      .pipe(
        Effect.mapError(
          (error) => new Error(`EGRESS_PROXY_ADDRESS needs ENVELOPE_KEYS to seal proxy logins: ${error.message}`),
        ),
        Effect.orDie,
      )
    const retire = Effect.fn("SandboxEgress.retire")(function* (workload: Pick<Workload.Info, "kind" | "id">) {
      const revoked = yield* callers.revoke({ kind: workload.kind, id: workload.id })
      yield* Effect.forEach(revoked.logins, (login) => control.invalidate({ login }), { discard: true })
    })
    return Service.of({
      enabled: true,
      retire,
      proxyFor: Effect.fn("SandboxEgress.proxyFor")(function* (caller) {
        const kept = yield* callers.placement(caller)
        const placement = Option.isSome(kept)
          ? kept.value
          : yield* retire(caller.workload).pipe(Effect.andThen(callers.issue(caller, "ProxyLogin")))
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

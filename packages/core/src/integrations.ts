export * as Integrations from "./integrations.js"

import type { Space } from "@ren/schema/space"
import type { Workload } from "@ren/schema/workload"
import { Clock, Config, Context, DateTime, Duration, Effect, Layer, Option } from "effect"
import { Signer } from "./signer.js"

export const label = "INTEGRATIONS"

// oxlint-disable-next-line ren/no-comments -- Where the integrations service serves the managed MCPs. Without it, this Ren has no managed MCPs. A value that is not a URL stops Ren at startup.
export const url = Config.option(Config.URL("REN_INTEGRATIONS_URL"))

// oxlint-disable-next-line ren/no-comments -- One hour, so a retired generation's token stops soon after its sandbox (integrations spec §7.2).
const tokenLifetime = Duration.hours(1)

export interface Caller {
  readonly organizationId: string
  readonly spaceId: Space.ID
  readonly brain: Extract<Workload.Info, { readonly kind: "brain" }>
}

export interface Interface {
  readonly host: Option.Option<string>
  readonly token: (
    caller: Caller,
  ) => Effect.Effect<{ readonly token: string; readonly expiresAt: DateTime.Utc }, Signer.Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Integrations") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const signer = yield* Signer.Service
    const found = yield* url
    if (Option.isSome(found)) yield* signer.publicKeys("ren-integrations").pipe(Effect.orDie)
    return Service.of({
      host: Option.map(found, (value) => value.hostname),
      token: Effect.fn("Integrations.token")(function* (caller) {
        const exp = Math.floor(((yield* Clock.currentTimeMillis) + Duration.toMillis(tokenLifetime)) / 1000)
        const token = yield* signer.sign("ren-integrations", {
          org: caller.organizationId,
          space: caller.spaceId,
          brain: caller.brain.id,
          gen: caller.brain.generation,
          exp,
        })
        return { token, expiresAt: DateTime.makeUnsafe(exp * 1000) }
      }),
    })
  }),
)

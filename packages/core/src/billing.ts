export * as Billing from "./billing.js"

import { Auth } from "@ren/schema/auth"
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Signer } from "./signer.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Billing.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const Customer = Schema.Struct({
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  ownerEmail: Schema.String,
})
export type Customer = typeof Customer.Type

export interface Interface {
  readonly ensureCustomer: (customer: Customer) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Billing") {}

const tokenLifetimeSeconds = 5 * 60

export const layerRenCloud = Layer.effect(
  Service,
  Effect.gen(function* () {
    const base = yield* Config.String("REN_BILLING_URL")
    const signer = yield* Signer.Service
    yield* signer.publicKeys("ren-billing").pipe(Effect.orDie)
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(base)),
      HttpClient.filterStatus((status) => status === 204),
      HttpClient.transformResponse(Effect.timeout("15 seconds")),
    )

    return Service.of({
      ensureCustomer: Effect.fn("Billing.ensureCustomer")(
        function* (customer) {
          const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + tokenLifetimeSeconds
          const token = yield* signer.sign("ren-billing", { org: customer.organizationId, exp })
          yield* http.execute(
            HttpClientRequest.post("/billing/v1/customers").pipe(
              HttpClientRequest.bearerToken(token),
              HttpClientRequest.bodyJsonUnsafe({ name: customer.name, ownerEmail: customer.ownerEmail }),
            ),
          )
        },
        Effect.mapError((cause) => new Unavailable({ message: cause.message, cause })),
      ),
    })
  }),
)

export const layerNone = Layer.succeed(Service, Service.of({ ensureCustomer: () => Effect.void }))

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_BILLING_URL")), (url) =>
    Option.isSome(url) ? layerRenCloud : layerNone,
  ),
)

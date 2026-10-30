export * as Billing from "./billing.js"

import type { Auth } from "@ren/schema/auth"
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Signer } from "./signer.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Billing.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export const RefusalReason = Schema.Literals(["insufficient_credits", "budget_unreadable"])

export class Refused extends Schema.TaggedError<Refused>()("Billing.Refused", { reason: RefusalReason }) {}

export interface Interface {
  readonly ensureCustomer: (
    organizationId: Auth.OrganizationID,
    input: { readonly name: string; readonly ownerEmail: string },
  ) => Effect.Effect<void, Unavailable>
  readonly check: (organizationId: Auth.OrganizationID) => Effect.Effect<void, Refused>
  readonly removeOrganization: (organizationId: Auth.OrganizationID) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Billing") {}

const tokenLifetimeSeconds = 5 * 60

export const layerRenCloud = Layer.effect(
  Service,
  Effect.gen(function* () {
    const base = yield* Config.String("REN_BILLING_URL")
    const http = yield* HttpClient.HttpClient
    const signer = yield* Signer.Service

    const send = (organizationId: Auth.OrganizationID, method: "POST" | "DELETE", path: string, body?: object) =>
      Effect.gen(function* () {
        const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + tokenLifetimeSeconds
        const token = yield* signer
          .sign("ren-billing", { org: organizationId, exp })
          .pipe(Effect.mapError((cause) => new Unavailable({ message: cause.message, cause })))
        const request = HttpClientRequest.make(method)(new URL(path, base)).pipe(
          HttpClientRequest.bearerToken(token),
          body ? HttpClientRequest.bodyJsonUnsafe(body) : (self) => self,
        )
        const response = yield* http.execute(request).pipe(
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new Unavailable({ message: "Billing did not answer.", cause })),
        )
        return response.status
      })

    const expectNoContent = (status: number) =>
      status === 204 ? Effect.void : Effect.fail(new Unavailable({ message: `Billing answered ${status}.` }))

    return Service.of({
      ensureCustomer: Effect.fn("Billing.ensureCustomer")(function* (organizationId, input) {
        yield* expectNoContent(yield* send(organizationId, "POST", "/billing/v1/customers", input))
      }),
      check: Effect.fn("Billing.check")(function* (organizationId) {
        const status = yield* send(organizationId, "POST", "/billing/v1/check").pipe(
          Effect.mapError(() => new Refused({ reason: "budget_unreadable" })),
        )
        if (status === 204) return
        return yield* new Refused({ reason: status === 402 ? "insufficient_credits" : "budget_unreadable" })
      }),
      removeOrganization: Effect.fn("Billing.removeOrganization")(function* (organizationId) {
        yield* expectNoContent(
          yield* send(organizationId, "DELETE", `/billing/v1/organizations/${encodeURIComponent(organizationId)}`),
        )
      }),
    })
  }),
)

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    ensureCustomer: () => Effect.void,
    check: () => Effect.void,
    removeOrganization: () => Effect.void,
  }),
)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_BILLING_URL")), (url) =>
    Option.isSome(url) ? layerRenCloud : layerNone,
  ),
)

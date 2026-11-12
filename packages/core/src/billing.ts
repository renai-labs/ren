export * as Billing from "./billing.js"

import { Auth } from "@ren/schema/auth"
import { Billing } from "@ren/schema/billing"
import type { SessionUsage } from "@ren/schema/session/usage"
import { Clock, Config, Context, Effect, Layer, Option, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Primitive } from "./primitive.js"
import { Signer } from "./signer.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("Billing.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type Failure = Primitive.Invalid | Primitive.Conflict | Primitive.NotFound | Unavailable

export const Customer = Schema.Struct({
  organizationId: Auth.OrganizationID,
  name: Schema.String,
  ownerEmail: Schema.String,
})
export type Customer = typeof Customer.Type

export interface Costs {
  readonly models: number
  readonly tools: number
}

export interface Priced extends Costs {
  readonly source: SessionUsage.Source
}

export interface Interface {
  readonly ensureCustomer: (customer: Customer) => Effect.Effect<void, Unavailable>
  readonly summary: (organizationId: Auth.OrganizationID) => Effect.Effect<Billing.Summary, Failure>
  readonly plans: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<Billing.Plan>, Failure>
  readonly invoices: (
    organizationId: Auth.OrganizationID,
    query: Billing.InvoiceQuery,
  ) => Effect.Effect<Billing.InvoicePage, Failure>
  readonly invoiceUrl: (organizationId: Auth.OrganizationID, id: string) => Effect.Effect<Billing.Link, Failure>
  readonly subscribe: (
    organizationId: Auth.OrganizationID,
    input: Billing.PlanInput,
  ) => Effect.Effect<Billing.Checkout, Failure>
  readonly changePlan: (organizationId: Auth.OrganizationID, input: Billing.PlanInput) => Effect.Effect<void, Failure>
  readonly cancel: (organizationId: Auth.OrganizationID) => Effect.Effect<void, Failure>
  readonly portal: (organizationId: Auth.OrganizationID) => Effect.Effect<Billing.Link, Failure>
  readonly price: (organizationId: Auth.OrganizationID, costs: Costs) => Effect.Effect<Priced>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Billing") {}

const tokenLifetimeSeconds = 5 * 60

const Code = Schema.Literals([
  "invalid_plan",
  "already_subscribed",
  "no_subscription",
  "not_enrolled",
  "provider_refused",
  "plan_change_pending",
  "not_found",
])

// oxlint-disable-next-line ren/no-comments -- The billing service answers `{ error: <code> }`; Ren keeps the text that a person reads.
const refusals: Record<typeof Code.Type, Primitive.Invalid | Primitive.Conflict | Primitive.NotFound> = {
  invalid_plan: new Primitive.Invalid({ message: "Unknown plan." }),
  already_subscribed: new Primitive.Invalid({ message: "This organization already has a plan. Change it instead." }),
  no_subscription: new Primitive.Invalid({ message: "No active subscription to change." }),
  not_enrolled: new Primitive.Invalid({ message: "Billing is not set up for this organization." }),
  provider_refused: new Primitive.Invalid({ message: "Couldn’t update your plan. Please try again." }),
  plan_change_pending: new Primitive.Conflict({
    message: "A previous payment is still processing — please try again shortly.",
  }),
  not_found: new Primitive.NotFound({ message: "Invoice not found." }),
}

const ErrorBody = Schema.Struct({ error: Code })

const unavailable = (cause: unknown) =>
  new Unavailable({ message: "Billing is not available now. Try again later.", cause })

export const layerRenCloud = Layer.effect(
  Service,
  Effect.gen(function* () {
    const base = yield* Config.String("REN_BILLING_URL")
    const signer = yield* Signer.Service
    yield* signer.publicKeys("ren-billing").pipe(Effect.orDie)
    const http = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.prependUrl(base)),
      HttpClient.transformResponse(Effect.timeout("15 seconds")),
    )

    const send = Effect.fnUntraced(function* (
      organizationId: Auth.OrganizationID,
      request: HttpClientRequest.HttpClientRequest,
    ) {
      const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + tokenLifetimeSeconds
      const token = yield* signer.sign("ren-billing", { org: organizationId, exp }).pipe(Effect.mapError(unavailable))
      const response = yield* http
        .execute(request.pipe(HttpClientRequest.bearerToken(token), HttpClientRequest.acceptJson))
        .pipe(Effect.mapError(unavailable))
      if (response.status < 400) return response
      const code = yield* response.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(ErrorBody)),
        Effect.map((body) => body.error),
        Effect.orElseSucceed(() => undefined),
      )
      if (code) return yield* refusals[code]
      return yield* unavailable(new Error(`Billing answered ${response.status}.`))
    })

    const call = Effect.fnUntraced(function* <A, I>(
      organizationId: Auth.OrganizationID,
      request: HttpClientRequest.HttpClientRequest,
      success: Schema.Codec<A, I>,
    ) {
      const response = yield* send(organizationId, request)
      const json = yield* response.json.pipe(Effect.mapError(unavailable))
      return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(success))(json).pipe(Effect.mapError(unavailable))
    })

    return Service.of({
      price: (_organizationId, costs) => Effect.succeed({ ...costs, source: "provider" }),
      ensureCustomer: Effect.fn("Billing.ensureCustomer")(
        function* (customer) {
          yield* send(
            customer.organizationId,
            HttpClientRequest.post("/billing/v1/customers").pipe(
              HttpClientRequest.bodyJsonUnsafe({ name: customer.name, ownerEmail: customer.ownerEmail }),
            ),
          )
        },
        Effect.mapError((cause) =>
          cause._tag === "Billing.Unavailable" ? cause : new Unavailable({ message: cause.message, cause }),
        ),
      ),
      summary: Effect.fn("Billing.summary")(function* (organizationId) {
        return yield* call(organizationId, HttpClientRequest.get("/billing/v1/summary"), Billing.Summary)
      }),
      plans: Effect.fn("Billing.plans")(function* (organizationId) {
        return yield* call(organizationId, HttpClientRequest.get("/billing/v1/plans"), Schema.Array(Billing.Plan))
      }),
      invoices: Effect.fn("Billing.invoices")(function* (organizationId, query) {
        return yield* call(
          organizationId,
          HttpClientRequest.get("/billing/v1/invoices").pipe(
            HttpClientRequest.setUrlParams({ page: String(query.page), perPage: String(query.perPage) }),
          ),
          Billing.InvoicePage,
        )
      }),
      invoiceUrl: Effect.fn("Billing.invoiceUrl")(function* (organizationId, id) {
        return yield* call(
          organizationId,
          HttpClientRequest.get(`/billing/v1/invoices/${encodeURIComponent(id)}/url`),
          Billing.Link,
        )
      }),
      subscribe: Effect.fn("Billing.subscribe")(function* (organizationId, input) {
        return yield* call(
          organizationId,
          HttpClientRequest.post("/billing/v1/subscribe").pipe(HttpClientRequest.bodyJsonUnsafe(input)),
          Billing.Checkout,
        )
      }),
      changePlan: Effect.fn("Billing.changePlan")(function* (organizationId, input) {
        yield* send(
          organizationId,
          HttpClientRequest.post("/billing/v1/change-plan").pipe(HttpClientRequest.bodyJsonUnsafe(input)),
        )
      }),
      cancel: Effect.fn("Billing.cancel")(function* (organizationId) {
        yield* send(organizationId, HttpClientRequest.post("/billing/v1/cancel"))
      }),
      portal: Effect.fn("Billing.portal")(function* (organizationId) {
        return yield* call(organizationId, HttpClientRequest.post("/billing/v1/portal"), Billing.Link)
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- With no billing service, every organization is on Free with no credit and no plans to pick.
export const none = Service.of({
  ensureCustomer: () => Effect.void,
  summary: () =>
    Effect.succeed({
      plan: "free",
      planStatus: null,
      renewsAt: null,
      pendingPlan: null,
      availableMicroUsd: 0,
      grantedMicroUsd: 0,
    }),
  plans: () => Effect.succeed([]),
  invoices: () => Effect.succeed({ invoices: [], nextPage: null }),
  invoiceUrl: () => Effect.succeed({ url: "" }),
  subscribe: () => Effect.succeed({ checkoutUrl: "" }),
  changePlan: () => Effect.void,
  cancel: () => Effect.void,
  portal: () => Effect.succeed({ url: "" }),
  price: (_organizationId, costs) => Effect.succeed({ ...costs, source: "provider" }),
})

export const layerNone = Layer.succeed(Service, none)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_BILLING_URL")), (url) =>
    Option.isSome(url) ? layerRenCloud : layerNone,
  ),
)

export * as RenInference from "./ren-inference.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import { RenInference } from "@ren/schema/ren-inference"
import { and, eq } from "drizzle-orm"
import { Clock, Config, Context, Effect, Layer, Option, Schema, Struct } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { RenInferencePolicy } from "./ren-inference/policy.js"
import { Signer } from "./signer.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("RenInference.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Unavailable

export interface Interface {
  readonly connect: (
    actor: Actor.Info,
    input: RenInference.ConnectInput,
  ) => Effect.Effect<RenInference.ConnectResult, Failure>
  readonly list: (actor: Actor.Info) => Effect.Effect<ReadonlyArray<RenInference.Connection>, Failure>
  readonly rename: (
    actor: Actor.Info,
    id: string,
    input: RenInference.RenameInput,
  ) => Effect.Effect<RenInference.Connection, Failure>
  readonly remove: (actor: Actor.Info, id: string) => Effect.Effect<void, Failure>
  readonly catalog: (organizationId: Auth.OrganizationID) => Effect.Effect<Models.Catalog, Unavailable>
  readonly grant: (brainId: Brain.ID, organizationId: Auth.OrganizationID) => Effect.Effect<Models.ApiKey, Unavailable>
  readonly removeMember: (
    organizationId: Auth.OrganizationID,
    memberId: typeof Auth.MemberID.Type,
  ) => Effect.Effect<void, Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/RenInference") {}

const tokenLifetimeSeconds = 5 * 60
const roleOrder = ["owner", "admin", "member"] as const

const ErrorBody = Schema.Struct({ error: Schema.optional(Schema.String) })

// oxlint-disable-next-line ren/no-comments -- A connection as the service sends it: the user who connected it, never who may manage it, which Ren decides.
const Upstream = Schema.Struct({
  ...Struct.omit(RenInference.Connection.fields, ["canManage"]),
  connectedBy: Schema.NullOr(Schema.String),
})

const notFound = new Primitive.NotFound({ message: "Connection not found." })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const base = yield* Config.String("REN_INFERENCE_URL")
    const http = yield* HttpClient.HttpClient
    const signer = yield* Signer.Service
    const database = yield* Database.Service
    const access = yield* Access.Service

    const send = (
      claims: { readonly org: string; readonly sub?: string; readonly member?: string; readonly role?: string },
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      body?: object,
    ) =>
      Effect.gen(function* () {
        const exp = Math.floor((yield* Clock.currentTimeMillis) / 1000) + tokenLifetimeSeconds
        const token = yield* signer
          .sign("ren-inference", { ...claims, exp })
          .pipe(Effect.mapError((cause) => new Unavailable({ message: cause.message, cause })))
        const request = HttpClientRequest.make(method)(new URL(path, base)).pipe(
          HttpClientRequest.bearerToken(token),
          HttpClientRequest.acceptJson,
          body ? HttpClientRequest.bodyJsonUnsafe(body) : (self) => self,
        )
        const response = yield* http.execute(request).pipe(
          Effect.timeout("15 seconds"),
          Effect.mapError((cause) => new Unavailable({ message: "The Ren Inference Service did not answer.", cause })),
        )
        if (response.status >= 400) {
          const detail = yield* response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(ErrorBody)),
            Effect.map((found) => found.error),
            Effect.orElseSucceed(() => undefined),
          )
          const message = detail ?? `The Ren Inference Service answered ${response.status}.`
          if (response.status === 400) return yield* new Primitive.Invalid({ message })
          if (response.status === 403) return yield* new Primitive.Forbidden({ message })
          if (response.status === 404) return yield* new Primitive.NotFound({ message })
          return yield* new Unavailable({ message })
        }
        return response
      })

    const call = <A, I>(
      claims: { readonly org: string; readonly sub?: string; readonly member?: string; readonly role?: string },
      method: "GET" | "POST" | "PATCH" | "DELETE",
      path: string,
      success: Schema.Codec<A, I>,
      body?: object,
    ) =>
      Effect.gen(function* () {
        const response = yield* send(claims, method, path, body)
        const json = yield* response.json.pipe(
          Effect.mapError((cause) => new Unavailable({ message: "The Ren Inference Service sent no JSON.", cause })),
        )
        return yield* Schema.decodeUnknownEffect(Schema.toCodecJson(success))(json).pipe(
          Effect.mapError(
            (cause) =>
              new Unavailable({ message: `The Ren Inference Service sent an unexpected answer to ${path}.`, cause }),
          ),
        )
      })

    const personOf = Effect.fn("RenInference.personOf")(function* (actor: Actor.Info) {
      const member = (yield* database.db
        .select({ id: Database.Schema.member.id })
        .from(Database.Schema.member)
        .where(
          and(
            eq(Database.Schema.member.organizationId, actor.organizationId),
            eq(Database.Schema.member.userId, actor.userId),
          ),
        )
        .pipe(Effect.orDie)).at(0)
      if (!member) return yield* new Primitive.Forbidden({ message: "You are not a member of this organization." })
      // ast-grep-ignore: no-hardcoded-policy, -- Sent until the service stops reading it; Ren decides every check (RenInferencePolicy).
      const role = roleOrder.find((candidate) => actor.roles.includes(candidate)) ?? "member"
      return { org: actor.organizationId, sub: actor.userId, member: member.id, role }
    })

    const forbidden = (actor: Actor.Info, action: string, resource: Access.Resource) =>
      access.isAllowed({ actor, action, resource })
        ? Effect.void
        : Effect.fail(new Primitive.Forbidden({ message: "You cannot change this connection." }))

    const connections = Effect.fnUntraced(function* (actor: Actor.Info) {
      yield* forbidden(actor, RenInferencePolicy.actions.list, Access.organization)
      const found = yield* call(yield* personOf(actor), "GET", "/v1/connections", Schema.Array(Upstream))
      return found.map((connection) => {
        const resource = RenInferencePolicy.connection({ isConnector: connection.connectedBy === actor.userId })
        const canManage = access.isAllowed({ actor, action: RenInferencePolicy.actions.manage, resource })
        return { resource, info: { ...Struct.omit(connection, ["connectedBy"]), canManage } }
      })
    })

    const manageable = Effect.fnUntraced(function* (actor: Actor.Info, id: string) {
      const found = (yield* connections(actor)).find((connection) => connection.info.id === id)
      if (!found) return yield* notFound
      yield* forbidden(actor, RenInferencePolicy.actions.manage, found.resource)
    })

    const onlyUnavailable = <A>(effect: Effect.Effect<A, Failure>) =>
      effect.pipe(
        Effect.catchTags({
          "Primitive.NotFound": (cause) => Effect.fail(new Unavailable({ message: cause.message, cause })),
          "Primitive.Forbidden": (cause) => Effect.fail(new Unavailable({ message: cause.message, cause })),
          "Primitive.Invalid": (cause) => Effect.fail(new Unavailable({ message: cause.message, cause })),
        }),
      )

    const removeMember = Effect.fn("RenInference.removeMember")(function* (
      organizationId: Auth.OrganizationID,
      memberId: typeof Auth.MemberID.Type,
    ) {
      yield* onlyUnavailable(send({ org: organizationId }, "DELETE", `/v1/members/${encodeURIComponent(memberId)}`))
    })

    return Service.of({
      connect: Effect.fn("RenInference.connect")(function* (actor, input) {
        yield* forbidden(actor, RenInferencePolicy.actions.connect, Access.organization)
        if (input.connectionId) yield* manageable(actor, input.connectionId)
        return yield* call(yield* personOf(actor), "POST", "/v1/connect", RenInference.ConnectResult, input)
      }),
      list: Effect.fn("RenInference.list")(function* (actor) {
        return (yield* connections(actor)).map((connection) => connection.info)
      }),
      rename: Effect.fn("RenInference.rename")(function* (actor, id, input) {
        yield* manageable(actor, id)
        const renamed = yield* call(
          yield* personOf(actor),
          "PATCH",
          `/v1/connections/${encodeURIComponent(id)}`,
          Upstream,
          input,
        )
        return { ...Struct.omit(renamed, ["connectedBy"]), canManage: true }
      }),
      remove: Effect.fn("RenInference.remove")(function* (actor, id) {
        yield* manageable(actor, id)
        yield* send(yield* personOf(actor), "DELETE", `/v1/connections/${encodeURIComponent(id)}`)
      }),
      catalog: Effect.fn("RenInference.catalog")(function* (organizationId) {
        return yield* onlyUnavailable(
          call({ org: organizationId }, "GET", "/model/info", Models.LiteLLMModelInfo).pipe(
            Effect.map(Models.fromLiteLLM),
          ),
        )
      }),
      grant: Effect.fn("RenInference.grant")(function* (brainId, organizationId) {
        return yield* onlyUnavailable(call({ org: organizationId }, "POST", "/v1/keys", Models.ApiKey, { brainId }))
      }),
      removeMember,
    })
  }),
)

const notConfigured = () => new Unavailable({ message: "The Ren Inference Service is not configured." })

export const layerNone = Layer.succeed(
  Service,
  Service.of({
    connect: () => Effect.fail(notConfigured()),
    list: () => Effect.fail(notConfigured()),
    rename: () => Effect.fail(notConfigured()),
    remove: () => Effect.fail(notConfigured()),
    catalog: () => Effect.fail(notConfigured()),
    grant: () => Effect.fail(notConfigured()),
    removeMember: () => Effect.void,
  }),
)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), (url) => (Option.isSome(url) ? layer : layerNone)),
)

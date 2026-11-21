export * as RenInference from "./ren-inference.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import type { Brain } from "@ren/schema/brain"
import { Models } from "@ren/schema/models"
import type { Usage } from "@ren/schema/usage"
import { RenInference } from "@ren/schema/ren-inference"
import type { Space } from "@ren/schema/space"
import { and, eq, gte, inArray, max, type SQL, sql } from "drizzle-orm"
import { Clock, Config, Context, DateTime, Effect, Layer, Option, Schema, Struct } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { Primitive } from "./primitive.js"
import { RenInferencePolicy } from "./ren-inference/policy.js"
import { Signer } from "./signer.js"

export class Unavailable extends Schema.TaggedError<Unavailable>()("RenInference.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | Primitive.Conflict | Unavailable

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
  readonly grant: (
    brainId: Brain.ID,
    organizationId: Auth.OrganizationID,
    spaceId: Space.ID,
  ) => Effect.Effect<Models.ApiKey, Unavailable>
  readonly removeMember: (
    organizationId: Auth.OrganizationID,
    memberId: typeof Auth.MemberID.Type,
  ) => Effect.Effect<void, Unavailable>
  readonly keys: (actor: Actor.Info) => Effect.Effect<RenInference.KeyList, Failure>
  readonly createKey: (
    actor: Actor.Info,
    input: RenInference.CreateKeyInput,
  ) => Effect.Effect<RenInference.CreatedKey, Failure>
  readonly revokeKey: (actor: Actor.Info, id: string) => Effect.Effect<void, Failure>
  readonly keySecret: (actor: Actor.Info, id: string) => Effect.Effect<RenInference.KeySecret, Failure>
  readonly keyUsage: (
    actor: Actor.Info,
    period: RenInference.Period,
  ) => Effect.Effect<ReadonlyArray<RenInference.KeyUsage>, Failure>
  readonly harnessPlan: (
    actor: Actor.Info,
    input: RenInference.HarnessPlanInput,
  ) => Effect.Effect<RenInference.HarnessPlan, Failure>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/RenInference") {}

const tokenLifetimeSeconds = 5 * 60

const ErrorBody = Schema.Struct({ error: Schema.optional(Schema.String) })

const Upstream = Schema.Struct({
  ...Struct.omit(RenInference.Connection.fields, ["canManage"]),
  connectedBy: Schema.NullOr(Schema.String),
})

const notFound = new Primitive.NotFound({ message: "Connection not found." })

const UpstreamKey = Schema.Struct({
  ...Struct.pick(RenInference.Key.fields, ["id", "name", "prefix", "status", "expiresAt", "createdAt"]),
  ownerMemberId: Auth.MemberID,
})

const UpstreamKeyList = Schema.Struct({ baseUrl: Schema.String, keys: Schema.Array(UpstreamKey) })

const UpstreamCreatedKey = Schema.Struct({ ...UpstreamKey.fields, secret: Schema.String, baseUrl: Schema.String })

const keyNotFound = new Primitive.NotFound({ message: "Inference key not found." })

const keyPrefix = "inference-key:"

const periodDays = { "7d": 7, "30d": 30, "90d": 90, all: null } as const satisfies Record<
  RenInference.Period,
  number | null
>

const events = Database.Schema.usage_event

const tokens = (...names: ReadonlyArray<keyof Usage.ModelCall>) =>
  sql<number>`coalesce(sum(${sql.join(
    names.map((name) => sql`coalesce((${events.data} ->> ${name})::bigint, 0)`),
    sql` + `,
  )}), 0)`.mapWith(Number)

const total = (expression: SQL) => sql<number>`coalesce(${expression}, 0)`.mapWith(Number)

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const base = yield* Config.String("REN_INFERENCE_URL")
    const http = yield* HttpClient.HttpClient
    const signer = yield* Signer.Service
    const database = yield* Database.Service
    const access = yield* Access.Service

    const send = (
      claims: { readonly org: string; readonly sub?: string; readonly member?: string },
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
          if (response.status === 409) return yield* new Primitive.Conflict({ message })
          return yield* new Unavailable({ message })
        }
        return response
      })

    const call = <A, I>(
      claims: { readonly org: string; readonly sub?: string; readonly member?: string },
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
      return { org: actor.organizationId, sub: actor.userId, member: member.id }
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
          "Primitive.Conflict": (cause) => Effect.fail(new Unavailable({ message: cause.message, cause })),
        }),
      )

    const removeMember = Effect.fn("RenInference.removeMember")(function* (
      organizationId: Auth.OrganizationID,
      memberId: typeof Auth.MemberID.Type,
    ) {
      yield* onlyUnavailable(send({ org: organizationId }, "DELETE", `/v1/members/${encodeURIComponent(memberId)}`))
    })

    const isLive = (status: RenInference.KeyStatus) => status === "active" || status === "revoke_pending"

    // oxlint-disable-next-line ren/no-comments -- The service lists every key of the org; Ren keeps the ones that `key.view` allows.
    const visibleKeys = Effect.fnUntraced(function* (actor: Actor.Info) {
      const person = yield* personOf(actor)
      const found = yield* call(person, "GET", "/v1/inference-keys", UpstreamKeyList)
      const keys = found.keys.flatMap((key) => {
        const resource = RenInferencePolicy.key({ isOwner: key.ownerMemberId === person.member })
        return access.isAllowed({ actor, action: RenInferencePolicy.actions.keyView, resource })
          ? [{ key, resource }]
          : []
      })
      return { person, baseUrl: found.baseUrl, keys }
    })

    const visibleKey = Effect.fnUntraced(function* (actor: Actor.Info, id: string) {
      const visible = yield* visibleKeys(actor)
      const found = visible.keys.find((each) => each.key.id === id)
      if (!found) return yield* keyNotFound
      return { person: visible.person, ...found }
    })

    const present = Effect.fnUntraced(function* (
      actor: Actor.Info,
      keys: ReadonlyArray<{ readonly key: typeof UpstreamKey.Type; readonly resource: Access.Resource }>,
    ) {
      const ownerIds = [...new Set(keys.map((each) => each.key.ownerMemberId))]
      const workloads = keys.map((each) => `${keyPrefix}${each.key.id}`)
      const [owners, lastCalls] = yield* Effect.all(
        [
          ownerIds.length === 0
            ? Effect.succeed([])
            : database.db
                .select({ id: Database.Schema.member.id, name: Database.Schema.user.name })
                .from(Database.Schema.member)
                .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.member.userId))
                .where(
                  and(
                    eq(Database.Schema.member.organizationId, actor.organizationId),
                    inArray(Database.Schema.member.id, ownerIds),
                  ),
                ),
          workloads.length === 0
            ? Effect.succeed([])
            : database.db
                .select({ workload: events.workload, time: max(events.time) })
                .from(events)
                .where(and(eq(events.organization, actor.organizationId), inArray(events.workload, workloads)))
                .groupBy(events.workload),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.orDie)
      const names = new Map(owners.map((owner) => [owner.id, owner.name]))
      const lastUsed = new Map(lastCalls.map((each) => [each.workload, each.time]))
      return keys.map(({ key, resource }): RenInference.Key => {
        const last = lastUsed.get(`${keyPrefix}${key.id}`)
        return {
          ...Struct.omit(key, ["ownerMemberId"]),
          owner: { memberId: key.ownerMemberId, name: names.get(key.ownerMemberId) ?? null },
          lastUsedAt: last ? DateTime.fromDateUnsafe(last) : null,
          canRevoke:
            isLive(key.status) && access.isAllowed({ actor, action: RenInferencePolicy.actions.keyRevoke, resource }),
        }
      })
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
      grant: Effect.fn("RenInference.grant")(function* (brainId, organizationId, spaceId) {
        return yield* onlyUnavailable(
          call({ org: organizationId }, "POST", "/v1/keys", Models.ApiKey, { brainId, spaceId }),
        )
      }),
      removeMember,
      keys: Effect.fn("RenInference.keys")(function* (actor) {
        const visible = yield* visibleKeys(actor)
        return { baseUrl: visible.baseUrl, keys: yield* present(actor, visible.keys) }
      }),
      createKey: Effect.fn("RenInference.createKey")(function* (actor, input) {
        if (!access.isAllowed({ actor, action: RenInferencePolicy.actions.keyCreate, resource: Access.organization }))
          return yield* new Primitive.Forbidden({ message: "You cannot create inference keys." })
        const created = yield* call(yield* personOf(actor), "POST", "/v1/inference-keys", UpstreamCreatedKey, input)
        const presented = yield* present(actor, [
          { key: Struct.omit(created, ["secret", "baseUrl"]), resource: RenInferencePolicy.key({ isOwner: true }) },
        ])
        const key = presented.at(0)
        if (!key) return yield* Effect.die(new Error("A created key has no presentation."))
        return {
          id: key.id,
          name: key.name,
          prefix: key.prefix,
          status: key.status,
          owner: key.owner,
          expiresAt: key.expiresAt,
          lastUsedAt: key.lastUsedAt,
          createdAt: key.createdAt,
          canRevoke: key.canRevoke,
          secret: created.secret,
          baseUrl: created.baseUrl,
        }
      }),
      revokeKey: Effect.fn("RenInference.revokeKey")(function* (actor, id) {
        const found = yield* visibleKey(actor, id)
        if (!access.isAllowed({ actor, action: RenInferencePolicy.actions.keyRevoke, resource: found.resource }))
          return yield* new Primitive.Forbidden({ message: "You cannot revoke this key." })
        yield* send(found.person, "DELETE", `/v1/inference-keys/${encodeURIComponent(id)}`)
      }),
      keySecret: Effect.fn("RenInference.keySecret")(function* (actor, id) {
        const found = yield* visibleKey(actor, id)
        if (!access.isAllowed({ actor, action: RenInferencePolicy.actions.keySecret, resource: found.resource }))
          return yield* new Primitive.Forbidden({ message: "Only the owner of a key can read it." })
        return yield* call(
          found.person,
          "GET",
          `/v1/inference-keys/${encodeURIComponent(id)}/secret`,
          RenInference.KeySecret,
        )
      }),
      // oxlint-disable-next-line ren/no-comments -- The owner of a row is its `member`, so `key.view` applies with no call to the service.
      keyUsage: Effect.fn("RenInference.keyUsage")(function* (actor, period) {
        const seesEvery = access.isAllowed({
          actor,
          action: RenInferencePolicy.actions.keyView,
          resource: Access.organization,
        })
        const member = seesEvery ? null : yield* Actor.memberOf(database.db, actor)
        const days = periodDays[period]
        const now = yield* Clock.currentTimeMillis
        const rows = yield* database.db
          .select({
            workload: events.workload,
            model: sql<string>`${events.data} ->> 'requested_model'`,
            payer: events.payer,
            calls: total(sql`count(*)`),
            failed: total(sql`count(*) filter (where ${events.error} is not null)`),
            inputTokens: tokens("input_tokens"),
            outputTokens: tokens("output_tokens"),
            reasoningTokens: tokens("reasoning_tokens"),
            cacheReadTokens: tokens("cache_read_tokens"),
            cacheWriteTokens: tokens("cache_write_tokens", "cache_write_1h_tokens"),
            cost: total(sql`sum(${events.cost_micro_usd})`),
          })
          .from(events)
          .where(
            and(
              eq(events.organization, actor.organizationId),
              sql`starts_with(${events.workload}, ${keyPrefix})`,
              days ? gte(events.time, new Date(now - days * 24 * 60 * 60 * 1000)) : undefined,
              member ? eq(events.member, member) : undefined,
            ),
          )
          .groupBy(events.workload, sql`2`, events.payer)
          .orderBy(events.workload, sql`2`, events.payer)
          .pipe(Effect.orDie)
        const byKey = Map.groupBy(rows, (row) => row.workload.slice(keyPrefix.length))
        return [...byKey].map(([keyId, lines]) => ({
          keyId,
          charged: lines.filter((line) => line.payer === "ren").reduce((sum, line) => sum + line.cost, 0),
          calls: lines.reduce((sum, line) => sum + line.calls, 0),
          failed: lines.reduce((sum, line) => sum + line.failed, 0),
          models: lines.map((line) => Struct.omit(line, ["workload"])),
        }))
      }),
      harnessPlan: Effect.fn("RenInference.harnessPlan")(function* (actor, input) {
        return yield* call(yield* personOf(actor), "POST", "/v1/harness-plans", RenInference.HarnessPlan, input)
      }),
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
    grant: () => Effect.fail(notConfigured()),
    removeMember: () => Effect.void,
    keys: () => Effect.fail(notConfigured()),
    createKey: () => Effect.fail(notConfigured()),
    revokeKey: () => Effect.fail(notConfigured()),
    keySecret: () => Effect.fail(notConfigured()),
    keyUsage: () => Effect.succeed([]),
    harnessPlan: () => Effect.fail(notConfigured()),
  }),
)

export const layerConfig = Layer.unwrap(
  Effect.map(Config.option(Config.String("REN_INFERENCE_URL")), (url) => (Option.isSome(url) ? layer : layerNone)),
)

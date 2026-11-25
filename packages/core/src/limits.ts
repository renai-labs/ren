export * as Limits from "./limits.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Limits } from "@ren/schema/limits"
import type { Session } from "@ren/schema/session"
import { and, desc, eq, isNull, sql } from "drizzle-orm"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Billing } from "./billing.js"
import type { InferencePlugin } from "./inference-plugin.js"
import { ModelLists } from "./model-lists.js"
import { Primitive } from "./primitive.js"
import { SessionPolicy } from "./session/policy.js"
import { SpaceQueries } from "./space/queries.js"

export interface Interface {
  readonly get: (actor: Actor.Info, id: Session.ID) => Effect.Effect<Limits.Info, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Limits") {}

const notFound = new Primitive.NotFound({ message: "Session not found." })

const none: Limits.Info = { limits: [], credit: null }

const decodeModel = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, providerID: Schema.String })),
)

const percentOf = (used: number, total: number) => Math.max(0, Math.floor((used / total) * 100))

// oxlint-disable-next-line ren/no-comments -- A source that does not answer shows nothing: a banner is a hint, and the chat must not fail for it.
const quiet = <A, E>(effect: Effect.Effect<A, E>, fallback: A) =>
  effect.pipe(
    Effect.tapError((cause) => Effect.logWarning("A limit source did not answer", cause)),
    Effect.orElseSucceed(() => fallback),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const billing = yield* Billing.Service
    const lists = yield* ModelLists.Service
    const sessions = Database.Schema.agent_session
    const events = Database.Schema.usage_event

    const rootOf = Effect.fnUntraced(function* (actor: Actor.Info, id: Session.ID) {
      const root = (yield* database.db
        .select({ id: sessions.root_id })
        .from(sessions)
        .where(and(eq(sessions.id, id), eq(sessions.organization_id, actor.organizationId)))
        .pipe(Effect.orDie)).at(0)
      if (!root) return yield* notFound
      const visible = yield* database.db
        .select({ id: sessions.id })
        .from(sessions)
        .innerJoin(Database.Schema.space, eq(Database.Schema.space.id, sessions.space_id))
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(
          and(
            eq(sessions.id, root.id),
            isNull(Database.Schema.space.archived_at),
            Access.where(access.plan(actor, SessionPolicy.actions.get), SpaceQueries.where),
          ),
        )
        .pipe(Effect.orDie)
      if (visible.length === 0) return yield* notFound
      return root.id
    })

    // oxlint-disable-next-line ren/no-comments -- Providers P23: the seat that served the chat's last seat call. The inference service answers its windows only when it is a seat of the chat's provider.
    const lastSeat = (organizationId: Auth.OrganizationID, root: Session.ID) => {
      const seatOf = sql<string>`${events.data} ->> 'seat'`
      return database.db
        .select({ seat: seatOf })
        .from(events)
        .where(and(eq(events.organization, organizationId), eq(events.root_session, root), sql`${seatOf} is not null`))
        .orderBy(desc(events.time))
        .limit(1)
        .pipe(
          Effect.orDie,
          Effect.map((rows) => rows.at(0)?.seat),
        )
    }

    const nameOf = Effect.fnUntraced(function* (seat: Extract<InferencePlugin.Limit, { _tag: "seat" }>) {
      const connector = seat.connectedBy
        ? (yield* database.db
            .select({ name: Database.Schema.user.name })
            .from(Database.Schema.user)
            .where(eq(Database.Schema.user.id, seat.connectedBy))
            .pipe(Effect.orDie)).at(0)?.name
        : undefined
      return connector && seat.plan ? `${connector}’s ${seat.plan}` : seat.label
    })

    const limitsOf = Effect.fnUntraced(function* (found: ReadonlyArray<InferencePlugin.Limit>, providerName: string) {
      return (yield* Effect.forEach(found, (limit) =>
        limit._tag === "free"
          ? Effect.succeed<ReadonlyArray<Limits.Limit>>([
              {
                _tag: "free",
                key: "free",
                percent: percentOf(limit.used, limit.limit),
                resetsAt: limit.resetsAt,
                used: limit.used,
                limit: limit.limit,
              },
            ])
          : Effect.map(nameOf(limit), (seat) =>
              limit.windows.flatMap((window): ReadonlyArray<Limits.Limit> =>
                typeof window.percent !== "number"
                  ? []
                  : [
                      {
                        _tag: "seat",
                        key: `seat:${limit.id}:${window.key}`,
                        percent: Math.max(0, Math.floor(window.percent)),
                        resetsAt: window.resetsAt,
                        seat,
                        providerName,
                        window: window.key,
                        title: window.title,
                      },
                    ],
              ),
            ),
      )).flat()
    })

    // oxlint-disable-next-line ren/no-comments -- Providers §9.2: billing holds the credit. With none granted (`Billing.layerNone`) there is nothing to show.
    const credit = (organizationId: Auth.OrganizationID) =>
      quiet(
        Effect.map(billing.summary(organizationId), (summary): Limits.Credit | null =>
          summary.grantedMicroUsd > 0
            ? {
                _tag: "credit",
                key: "credit",
                percent: percentOf(summary.grantedMicroUsd - summary.availableMicroUsd, summary.grantedMicroUsd),
                resetsAt: summary.renewsAt,
                availableMicroUsd: summary.availableMicroUsd,
              }
            : null,
        ),
        null,
      )

    return Service.of({
      // oxlint-disable-next-line ren/no-comments -- Providers §9.3: the limits of the chat's current model from its provider's inference service, and the credit when Ren pays for the model.
      get: Effect.fn("Limits.get")(function* (actor, id) {
        const root = yield* rootOf(actor, id)
        const row = (yield* database.db
          .select({ model: Database.Schema.opencode_session.model })
          .from(Database.Schema.opencode_session)
          .where(eq(Database.Schema.opencode_session.session_id, root))
          .pipe(Effect.orDie)).at(0)
        const current = Option.flatMap(Option.fromNullishOr(row?.model), decodeModel)
        if (Option.isNone(current)) return none
        const owned = (yield* quiet(lists.providers, [])).find((each) => each.provider.id === current.value.providerID)
        if (!owned) return none
        const model = (yield* quiet(lists.models(actor.organizationId, owned), [])).find(
          (each) => each.id === current.value.id,
        )
        if (!model) return none
        const seat = yield* lastSeat(actor.organizationId, root)
        const found = yield* quiet(
          owned.plugin.limits(owned.provider.id, actor.organizationId, {
            model: ModelLists.switchId(model),
            ...(seat && { seat }),
          }),
          [],
        )
        return {
          limits: yield* limitsOf(found, owned.provider.name),
          credit: owned.provider.payer === "ren" && !model.free ? yield* credit(actor.organizationId) : null,
        }
      }),
    })
  }),
)

export * as Limits from "./limits.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Limits } from "@ren/schema/limits"
import type { Session } from "@ren/schema/session"
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { Billing } from "./billing.js"
import { ModelLists } from "./model-lists.js"
import { Primitive } from "./primitive.js"
import { RenInference } from "./ren-inference.js"
import { SessionPolicy } from "./session/policy.js"
import { SpaceQueries } from "./space/queries.js"

export interface Interface {
  readonly get: (actor: Actor.Info, id: Session.ID) => Effect.Effect<Limits.Info, Primitive.NotFound>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/Limits") {}

const notFound = new Primitive.NotFound({ message: "Session not found." })

const decodeModel = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, providerID: Schema.String })),
)

const percentOf = (used: number, total: number) => Math.max(0, Math.floor((used / total) * 100))

// oxlint-disable-next-line ren/no-comments -- A source that does not answer shows no meter: a banner is a hint, and the chat must not fail for it.
const quiet = <A, E>(effect: Effect.Effect<ReadonlyArray<A>, E>) =>
  effect.pipe(
    Effect.tapError((cause) => Effect.logWarning("A limit source did not answer", cause)),
    Effect.orElseSucceed((): ReadonlyArray<A> => []),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const inference = yield* RenInference.Service
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

    const free = (organizationId: Auth.OrganizationID) =>
      quiet(
        Effect.map(inference.freeUsage(organizationId), (usage): ReadonlyArray<Limits.Meter> => [
          {
            _tag: "free",
            key: "free",
            percent: percentOf(usage.used, usage.limit),
            resetsAt: usage.resetsAt,
            used: usage.used,
            limit: usage.limit,
          },
        ]),
      )

    const credit = (organizationId: Auth.OrganizationID) =>
      quiet(
        Effect.map(billing.summary(organizationId), (summary): ReadonlyArray<Limits.Meter> =>
          summary.grantedMicroUsd > 0
            ? [
                {
                  _tag: "credit",
                  key: "credit",
                  percent: percentOf(summary.grantedMicroUsd - summary.availableMicroUsd, summary.grantedMicroUsd),
                  resetsAt: summary.renewsAt,
                  availableMicroUsd: summary.availableMicroUsd,
                },
              ]
            : [],
        ),
      )

    // oxlint-disable-next-line ren/no-comments -- Providers P23: the seat of the card's vendor that served the chat's last seat call.
    const seat = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID, root: Session.ID, vendor: string) {
      const vendorSeats = (yield* inference.seats(organizationId)).filter((each) => each.providerId === vendor)
      if (vendorSeats.length === 0) return []
      const seatOf = sql<string>`${events.data} ->> 'seat'`
      const last = (yield* database.db
        .select({ seat: seatOf })
        .from(events)
        .where(
          and(
            eq(events.organization, organizationId),
            eq(events.root_session, root),
            sql`${seatOf} is not null`,
            inArray(
              seatOf,
              vendorSeats.map((each) => each.id),
            ),
          ),
        )
        .orderBy(desc(events.time))
        .limit(1)
        .pipe(Effect.orDie)).at(0)
      const found = vendorSeats.find((each) => each.id === last?.seat)
      if (!found) return []
      const connector = found.connectedBy
        ? (yield* database.db
            .select({ name: Database.Schema.user.name })
            .from(Database.Schema.user)
            .where(eq(Database.Schema.user.id, found.connectedBy))
            .pipe(Effect.orDie)).at(0)?.name
        : undefined
      const name = connector && found.plan ? `${connector}’s ${found.plan}` : found.label
      return found.meters.flatMap((meter): ReadonlyArray<Limits.Meter> =>
        typeof meter.percent !== "number"
          ? []
          : [
              {
                _tag: "seat",
                key: `seat:${found.id}:${meter.key}`,
                percent: Math.max(0, Math.floor(meter.percent)),
                resetsAt: Option.getOrNull(Option.flatMap(Option.fromNullishOr(meter.resetsAt), DateTime.make)),
                seat: name,
                providerName: found.providerName,
                window: meter.key,
                title: meter.title,
              },
            ],
      )
    })

    return Service.of({
      // oxlint-disable-next-line ren/no-comments -- Providers §9.3: the meters of the chat's current model, from the card that serves it.
      get: Effect.fn("Limits.get")(function* (actor, id) {
        const root = yield* rootOf(actor, id)
        const row = (yield* database.db
          .select({ model: Database.Schema.opencode_session.model })
          .from(Database.Schema.opencode_session)
          .where(eq(Database.Schema.opencode_session.session_id, root))
          .pipe(Effect.orDie)).at(0)
        const model = Option.flatMap(Option.fromNullishOr(row?.model), decodeModel)
        if (Option.isNone(model)) return { meters: [] }
        const card = (yield* lists.list(actor.organizationId)).find((each) => each.id === model.value.providerID)
        if (card?.id === ModelLists.renCard)
          return {
            meters: card.models.find((each) => each.id === model.value.id)?.free
              ? yield* free(actor.organizationId)
              : yield* credit(actor.organizationId),
          }
        if (card?.method === "subscription") return { meters: yield* quiet(seat(actor.organizationId, root, card.id)) }
        return { meters: [] }
      }),
    })
  }),
)

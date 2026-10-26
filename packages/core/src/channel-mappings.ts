export * as ChannelMappings from "./channel-mappings.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { Channel } from "@ren/schema/channel"
import { ChannelInstall } from "@ren/schema/channel-install"
import { ChannelMapping } from "@ren/schema/channel-mapping"
import type { ChannelPlace } from "@ren/schema/channel-place"
import { and, asc, count, eq, inArray, isNull } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { Context, DateTime, Effect, Layer, Option, Schema, Struct } from "effect"
import { Access } from "./access.js"
import type { Actor } from "./actor.js"
import { AgentQueries } from "./agent/queries.js"
import { ChannelProvider } from "./channel-provider.js"
import { Primitive } from "./primitive.js"
import { SpacePolicy } from "./space/policy.js"
import { SpaceQueries } from "./space/queries.js"

export interface Interface extends Primitive.Interface<typeof ChannelMapping.definition> {
  readonly places: (
    actor: Actor.Info,
    input: ChannelPlace.ListInput,
  ) => Effect.Effect<ChannelPlace.Page, Primitive.NotFound | ChannelProvider.Unavailable>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ChannelMappings") {}

const table = Database.Schema.channel_mapping
const install = Database.Schema.channel_install
const space = Database.Schema.space
const agent = Database.Schema.agent
const fallbackUser = alias(Database.Schema.user, "fallback_user")

const actions = {
  list: Primitive.action(ChannelMapping.definition, "list"),
  create: Primitive.action(ChannelMapping.definition, "create"),
  remove: Primitive.action(ChannelMapping.definition, "remove"),
}

const notFound = new Primitive.NotFound({ message: "Mapping not found." })

const installNotFound = new Primitive.NotFound({ message: "Install not found." })

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const registry = yield* ChannelProvider.Registry

    const select = (executor: Database.Transaction) =>
      executor
        .select({
          mapping: table,
          provider: install.provider,
          space: { id: space.id, name: space.name },
          agent: { id: agent.id, name: agent.name },
          fallbackUser: { id: fallbackUser.id, name: fallbackUser.name },
        })
        .from(table)
        .innerJoin(install, eq(install.id, table.install_id))
        .innerJoin(space, eq(space.id, table.space_id))
        .leftJoin(agent, eq(agent.id, table.agent_id))
        .leftJoin(fallbackUser, eq(fallbackUser.id, table.fallback_user_id))

    type Row = Effect.Success<ReturnType<ReturnType<typeof select>["where"]>>[number]

    const toInfo = (row: Row): ChannelMapping.Info => ({
      id: row.mapping.id,
      installId: row.mapping.install_id,
      provider: row.provider,
      place: row.mapping.place,
      placeName: row.mapping.place_name,
      space: row.space,
      agent: row.agent,
      fallback: row.mapping.fallback,
      fallbackUser: row.fallbackUser && { id: Auth.UserID.make(row.fallbackUser.id), name: row.fallbackUser.name },
      triggers: row.mapping.triggers,
      createdAt: DateTime.fromDateUnsafe(row.mapping.created_at),
      updatedAt: DateTime.fromDateUnsafe(row.mapping.updated_at),
    })

    const installOf = (actor: Actor.Info, id: ChannelInstall.ID) =>
      Schema.is(ChannelInstall.ID)(id)
        ? database.db
            .select()
            .from(install)
            .where(and(eq(install.id, id), eq(install.organization_id, actor.organizationId)))
            .pipe(
              Effect.orDie,
              Effect.flatMap((rows) =>
                Option.match(Option.fromNullishOr(rows.at(0)), {
                  onNone: () => Effect.fail(installNotFound),
                  onSome: Effect.succeed,
                }),
              ),
            )
        : Effect.fail(installNotFound)

    const providerOf = (provider: Channel.Provider) =>
      Option.match(registry.get(provider), {
        onNone: () =>
          Effect.fail(
            new Primitive.Invalid({
              message: `${Channel.titles[provider]} is not set up on this Ren server.`,
              field: "installId",
            }),
          ),
        onSome: Effect.succeed,
      })

    const lockSpace = Effect.fnUntraced(function* (
      transaction: Database.Transaction,
      actor: Actor.Info,
      spaceId: ChannelMapping.Info["space"]["id"],
      action: string,
    ) {
      const row = (yield* transaction
        .select({ name: space.name, kind: space.kind, membershipId: SpaceQueries.membership.id })
        .from(space)
        .leftJoin(SpaceQueries.membership, SpaceQueries.membershipOf(actor))
        .where(and(eq(space.id, spaceId), eq(space.organization_id, actor.organizationId), isNull(space.archived_at)))
        .for("share", { of: space })).at(0)
      if (!row) return yield* new Primitive.NotFound({ message: "Space not found." })
      if (!access.isAllowed({ actor, action, resource: SpacePolicy.resource(row) }))
        return yield* new Primitive.Forbidden({ message: "Only a member of the space can map places to it." })
      return row
    })

    return Service.of({
      list: Effect.fn("ChannelMappings.list")(function* (actor: Actor.Info, input: ChannelMapping.ListInput) {
        if (!access.isAllowed({ actor, action: actions.list, resource: Access.organization }))
          return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        const where = and(
          eq(install.organization_id, actor.organizationId),
          input.installId ? eq(table.install_id, input.installId) : undefined,
          input.spaceId ? eq(table.space_id, input.spaceId) : undefined,
        )
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const rows = yield* select(transaction)
              .where(where)
              .orderBy(asc(table.place_name), asc(table.id))
              .limit(input.pageSize)
              .offset((input.page - 1) * input.pageSize)
            const totals = yield* transaction
              .select({ total: count() })
              .from(table)
              .innerJoin(install, eq(install.id, table.install_id))
              .where(where)
            return {
              items: rows.map(toInfo),
              page: input.page,
              pageSize: input.pageSize,
              total: totals.at(0)?.total ?? 0,
            }
          }),
        )
      }),

      places: Effect.fn("ChannelMappings.places")(function* (actor: Actor.Info, input: ChannelPlace.ListInput) {
        const found = yield* installOf(actor, input.installId)
        const provider = registry.get(found.provider)
        if (Option.isNone(provider)) return { items: [], page: input.page, pageSize: input.pageSize, total: 0 }
        const all = (yield* provider.value.places(found.workspace)).toSorted((left, right) =>
          left.name.localeCompare(right.name),
        )
        const shown = all.slice((input.page - 1) * input.pageSize, input.page * input.pageSize)
        const mapped =
          shown.length === 0
            ? []
            : yield* database.transaction((transaction) =>
                select(transaction).where(
                  and(
                    eq(table.install_id, found.id),
                    inArray(
                      table.place,
                      shown.map((place) => place.id),
                    ),
                  ),
                ),
              )
        const byPlace = new Map(mapped.map((row) => [row.mapping.place, row]))
        return {
          items: shown.map((place) => {
            const mapping = byPlace.get(place.id)
            return Object.assign(Struct.pick(place, ["id", "name", "private", "anyoneCanWrite", "description"]), {
              mapping: mapping ? toInfo(mapping) : null,
            })
          }),
          page: input.page,
          pageSize: input.pageSize,
          total: all.length,
        }
      }),

      create: Effect.fn("ChannelMappings.create")(function* (actor: Actor.Info, input: ChannelMapping.CreateInput) {
        const found = yield* installOf(actor, input.installId)
        const provider = yield* providerOf(found.provider)
        const title = Channel.titles[found.provider]
        const triggers = input.triggers ?? []
        const offered = new Set(provider.triggers.map((trigger) => trigger.id))
        const unknown = triggers.find((setting) => !offered.has(setting.id))
        if (unknown)
          return yield* new Primitive.Invalid({ message: `${title} has no trigger ${unknown.id}.`, field: "triggers" })
        if (new Set(triggers.map((setting) => setting.id)).size !== triggers.length)
          return yield* new Primitive.Invalid({ message: "Each trigger can be listed once.", field: "triggers" })
        const place = yield* provider
          .place(found.workspace, input.place)
          .pipe(
            Effect.catchTag("ChannelProvider.Unavailable", (error) =>
              Effect.logWarning(`A ${title} place could not be read`, error).pipe(
                Effect.andThen(Effect.fail(new Primitive.Conflict({ message: `${title} did not answer. Try again.` }))),
              ),
            ),
          )
        if (Option.isNone(place))
          return yield* new Primitive.Invalid({ message: `Ren can’t reach this place on ${title}.`, field: "place" })
        const fallbackUserId = input.fallbackUserId ?? actor.userId
        const values = {
          place_name: place.value.name,
          space_id: input.spaceId,
          agent_id: input.agentId ?? null,
          fallback: input.fallback ?? !place.value.anyoneCanWrite,
          fallback_user_id: fallbackUserId,
          triggers,
        }
        const written = yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const target = yield* lockSpace(transaction, actor, input.spaceId, actions.create)
            if (
              input.agentId &&
              (yield* transaction
                .select({ id: agent.id })
                .from(agent)
                .where(and(eq(agent.id, input.agentId), AgentQueries.isUsableIn(input.spaceId, actor.organizationId)))
                .for("share")).length === 0
            )
              return yield* new Primitive.Invalid({ message: "The agent is not in this space.", field: "agentId" })
            if (
              values.fallback &&
              !(yield* SpaceQueries.actsIn(transaction, access, actor.organizationId, input.spaceId, fallbackUserId))
            )
              return yield* new Primitive.Invalid({
                message: "The fallback user must be a member of the space.",
                field: "fallbackUserId",
              })
            const inserted = yield* transaction
              .insert(table)
              .values({
                id: ChannelMapping.ID.create(),
                install_id: found.id,
                place: input.place,
                created_by: actor.userId,
                ...values,
              })
              .onConflictDoNothing()
              .returning({ id: table.id })
            const where = and(eq(table.install_id, found.id), eq(table.place, input.place))
            if (inserted.length > 0) return { where, announce: Option.some(target.name) }
            const before = (yield* transaction.select().from(table).where(where).for("update")).at(0)
            if (!before) return yield* notFound
            const moved = before.space_id !== input.spaceId
            yield* transaction
              .update(table)
              .set({ ...values, updated_at: new Date() })
              .where(eq(table.id, before.id))
            return { where, announce: moved ? Option.some(target.name) : Option.none() }
          }),
        )
        if (Option.isSome(written.announce))
          yield* provider
            .announce(found.workspace, place.value, `Ren answers here for ${written.announce.value}.`)
            .pipe(Effect.catchCause((cause) => Effect.logWarning(`A ${title} mapping notice could not be sent`, cause)))
        const row = (yield* database.transaction((transaction) => select(transaction).where(written.where))).at(0)
        if (!row) return yield* notFound
        return toInfo(row)
      }),

      remove: Effect.fn("ChannelMappings.remove")(function* (actor: Actor.Info, id: ChannelMapping.ID) {
        if (!Schema.is(ChannelMapping.ID)(id)) return yield* notFound
        return yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            const row = (yield* select(transaction).where(
              and(eq(table.id, id), eq(install.organization_id, actor.organizationId)),
            )).at(0)
            if (!row) return yield* notFound
            yield* lockSpace(transaction, actor, row.space.id, actions.remove)
            yield* transaction.delete(table).where(eq(table.id, id))
            return toInfo(row)
          }),
        )
      }),
    })
  }),
)

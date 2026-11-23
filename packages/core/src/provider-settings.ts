export * as ProviderSettings from "./provider-settings.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { ProviderCard } from "@ren/schema/provider-card"
import type { RenInference as RenInferenceSchema } from "@ren/schema/ren-inference"
import { Settings } from "@ren/schema/settings"
import { and, eq, inArray, sql } from "drizzle-orm"
import { Config, Context, DateTime, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { ModelCatalog } from "./model-catalog.js"
import { ModelLists } from "./model-lists.js"
import { Primitive } from "./primitive.js"
import { ProviderPolicy } from "./provider-settings/policy.js"
import { RenInference } from "./ren-inference.js"

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | RenInference.Unavailable

type Fields = ProviderCard.KeyInput["fields"]

export interface Interface {
  readonly page: (actor: Actor.Info) => Effect.Effect<ProviderCard.Page, Failure>
  readonly update: (
    actor: Actor.Info,
    providerId: string,
    input: ProviderCard.UpdateInput,
  ) => Effect.Effect<ProviderCard.Page, Failure>
  readonly test: (
    actor: Actor.Info,
    providerId: string,
    fields: Fields,
  ) => Effect.Effect<ProviderCard.TestResult, Failure>
  readonly saveKey: (actor: Actor.Info, providerId: string, fields: Fields) => Effect.Effect<ProviderCard.Page, Failure>
  readonly removeKey: (actor: Actor.Info, providerId: string) => Effect.Effect<ProviderCard.Page, Failure>
  readonly renModels: (actor: Actor.Info) => Effect.Effect<ProviderCard.RenModels, Failure>
  readonly updateRenModels: (
    actor: Actor.Info,
    input: ProviderCard.RenModelsInput,
  ) => Effect.Effect<ProviderCard.RenModels, Failure>
  readonly changed: (organizationId: Auth.OrganizationID) => Effect.Effect<void, RenInference.Unavailable>
  readonly applyDefaultModel: (organizationId: Auth.OrganizationID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ProviderSettings") {}

const notFound = new Primitive.NotFound({ message: "Provider not found." })
const forbidden = new Primitive.Forbidden({ message: "Only organization admins and owners change providers." })

const onlyUnavailable = <A>(effect: Effect.Effect<A, RenInference.Failure>) =>
  effect.pipe(
    Effect.catchTags({
      "Primitive.NotFound": (cause) => Effect.fail(new RenInference.Unavailable({ message: cause.message, cause })),
      "Primitive.Forbidden": (cause) => Effect.fail(new RenInference.Unavailable({ message: cause.message, cause })),
      "Primitive.Invalid": (cause) => Effect.fail(new Primitive.Invalid({ message: cause.message })),
      "Primitive.Conflict": (cause) => Effect.fail(new RenInference.Unavailable({ message: cause.message, cause })),
    }),
  )

const keyOf = (
  row: ModelLists.OrganizationSettings["providers"][number] | undefined,
  names: ReadonlyMap<string, string>,
): ProviderCard.Key | null => {
  if (!row?.key_last4 || !row.key_tested_at) return null
  const savedBy = row.key_saved_by
  return {
    last4: row.key_last4,
    testedAt: DateTime.fromDateUnsafe(row.key_tested_at),
    savedBy: savedBy ? { memberId: savedBy, name: names.get(savedBy) ?? null } : null,
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const inference = yield* RenInference.Service
    const catalog = yield* ModelCatalog.Service
    const lists = yield* ModelLists.Service
    const defaultModel = yield* Config.option(Config.String("REN_DEFAULT_MODEL"))
    const providers = Database.Schema.organization_provider
    const renModelRows = Database.Schema.organization_ren_model

    const canManage = (actor: Actor.Info) =>
      access.isAllowed({ actor, action: ProviderPolicy.actions.manage, resource: Access.organization })

    const viewer = (actor: Actor.Info) =>
      access.isAllowed({ actor, action: ProviderPolicy.actions.view, resource: Access.organization })
        ? Effect.void
        : Effect.fail(notFound)

    const manager = (actor: Actor.Info) => (canManage(actor) ? Effect.void : Effect.fail(forbidden))

    // oxlint-disable-next-line ren/no-comments -- The gateway tests a key with one small request: to the provider's cheapest chat model on models.dev.
    const testModelOf = Effect.fnUntraced(function* (providerId: string) {
      const snapshot = yield* catalog.current
      const cheapest = snapshot.data.providers
        .find((provider) => provider.id === providerId)
        ?.models.filter((model) => model.type === "chat" && !model.deprecated)
        .reduce<ModelCatalog.Model | undefined>(
          (best, model) => (!best || (model.price?.input ?? Infinity) < (best.price?.input ?? Infinity) ? model : best),
          undefined,
        )
      if (!cheapest)
        return yield* new Primitive.Invalid({ message: "models.dev lists no chat model for this provider." })
      return cheapest.id
    })

    const definitionOf = (providerId: string) =>
      Option.match(Option.fromNullishOr(ProviderCard.definitionOf(providerId)), {
        onNone: () => Effect.fail(notFound),
        onSome: Effect.succeed,
      })

    const rowOf = (organizationId: Auth.OrganizationID, providerId: string) =>
      database.db
        .select()
        .from(providers)
        .where(and(eq(providers.organization_id, organizationId), eq(providers.provider_id, providerId)))
        .pipe(
          Effect.orDie,
          Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
        )

    const upsert = (row: typeof providers.$inferInsert) =>
      database.db
        .insert(providers)
        .values(row)
        .onConflictDoUpdate({
          target: [providers.organization_id, providers.provider_id],
          set: { ...row, updated_at: sql`now()` },
        })
        .pipe(Effect.orDie)

    const page = Effect.fn("ProviderSettings.page")(function* (actor: Actor.Info) {
      yield* viewer(actor)
      const snapshot = yield* catalog.current
      const settings = yield* lists.settingsOf(actor.organizationId)
      const cards = ModelLists.cardsOf(snapshot.data, lists.ren(snapshot), settings)
      const seats = yield* inference.list(actor).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("The gateway's seats are unavailable for the Providers page", error),
        ),
        Effect.orElseSucceed((): ReadonlyArray<RenInferenceSchema.Connection> => []),
      )
      const free = yield* inference.freeUsage(actor.organizationId).pipe(Effect.option)
      const savers = settings.providers.flatMap((row) => Option.toArray(Option.fromNullishOr(row.key_saved_by)))
      const names = new Map<string, string>(
        savers.length === 0
          ? []
          : (yield* database.db
              .select({ id: Database.Schema.member.id, name: Database.Schema.user.name })
              .from(Database.Schema.member)
              .innerJoin(Database.Schema.user, eq(Database.Schema.user.id, Database.Schema.member.userId))
              .where(inArray(Database.Schema.member.id, savers))
              .pipe(Effect.orDie)).map((row) => [row.id, row.name] as const),
      )
      const manages = canManage(actor)
      const rows = new Map(settings.providers.map((row) => [row.provider_id, row]))
      const counts = new Map(cards.map((card) => [card.id, card.models.length]))
      const seatsOf = Map.groupBy(seats, (seat) => seat.providerId ?? "")
      const renRow = settings.providers.find((row) => row.provider_id === ProviderCard.ren)
      const isRenOn = ModelLists.renEnabled(settings)
      const nameOf = (id: string) => snapshot.data.providers.find((provider) => provider.id === id)?.name ?? id
      const countOf = (id: string) =>
        snapshot.data.providers
          .find((provider) => provider.id === id)
          ?.models.filter((model) => model.type === "chat" && !model.deprecated).length ?? 0
      const added = ProviderCard.definitions.filter(
        (definition) =>
          settings.providers.some((row) => row.provider_id === definition.id) ||
          seats.some((seat) => seat.providerId === definition.id),
      )
      return {
        ren: {
          enabled: renRow?.enabled ?? true,
          newModelsOn: renRow?.new_models ?? true,
          modelCount: lists.ren(snapshot).filter((model) => isRenOn(model.info.gateway ?? model.info.id)).length,
          free: Option.match(free, {
            onNone: () => null,
            onSome: (usage) => ({ used: usage.used, limit: usage.limit, resetsAt: usage.resetsAt }),
          }),
          canManage: manages,
        },
        cards: added.map((definition): ProviderCard.Info => {
          const row = rows.get(definition.id)
          return {
            id: definition.id,
            name: nameOf(definition.id),
            enabled: row?.enabled ?? true,
            method: row?.method ?? (definition.subscription ? "subscription" : "key"),
            methods: definition.subscription ? ["key", "subscription"] : ["key"],
            fields: definition.fields,
            key: keyOf(row, names),
            seats: seatsOf.get(definition.id) ?? [],
            modelCount: counts.get(definition.id) ?? 0,
            canManage: manages,
          }
        }),
        available: ProviderCard.definitions.map((definition) => ({
          id: definition.id,
          name: nameOf(definition.id),
          modelCount: countOf(definition.id),
          fields: definition.fields,
          added: added.includes(definition),
        })),
      } satisfies ProviderCard.Page
    })

    // oxlint-disable-next-line ren/no-comments -- Ren's switches change what the gateway refuses: it hears them first, then pickers change.
    const tellSwitches = Effect.gen(function* () {
      yield* onlyUnavailable(
        ModelLists.tell(yield* catalog.current).pipe(
          Effect.provideService(RenInference.Service, inference),
          Effect.provideService(ModelLists.Service, lists),
        ),
      )
    })

    const renModels = Effect.fn("ProviderSettings.renModels")(function* (actor: Actor.Info) {
      yield* viewer(actor)
      const snapshot = yield* catalog.current
      const settings = yield* lists.settingsOf(actor.organizationId)
      const isOn = ModelLists.renEnabled({
        ...settings,
        providers: settings.providers.map((row) => ({ ...row, enabled: true })),
      })
      return {
        newModelsOn: settings.providers.find((row) => row.provider_id === ProviderCard.ren)?.new_models ?? true,
        canManage: canManage(actor),
        models: lists.ren(snapshot).map((model) => ({
          id: model.info.gateway ?? model.info.id,
          name: model.info.name ?? model.info.id,
          price: model.info.price ?? { input: 0, output: 0 },
          free: model.info.free === true,
          enabled: isOn(model.info.gateway ?? model.info.id),
        })),
      }
    })

    return Service.of({
      page,
      update: Effect.fn("ProviderSettings.update")(function* (actor, providerId, input) {
        yield* manager(actor)
        const current = yield* rowOf(actor.organizationId, providerId)
        if (providerId === ProviderCard.ren) {
          if (input.method === "subscription")
            return yield* new Primitive.Invalid({ message: "Ren has no subscription." })
          yield* upsert({
            organization_id: actor.organizationId,
            provider_id: ProviderCard.ren,
            enabled: input.enabled ?? Option.match(current, { onNone: () => true, onSome: (row) => row.enabled }),
            method: "key",
            new_models: Option.match(current, { onNone: () => true, onSome: (row) => row.new_models ?? true }),
          })
          yield* tellSwitches
          yield* lists.refresh(actor.organizationId)
          return yield* page(actor)
        }
        const definition = yield* definitionOf(providerId)
        const method =
          input.method ??
          Option.match(current, {
            onNone: () => (definition.subscription ? "subscription" : "key"),
            onSome: (row) => row.method,
          })
        if (method === "subscription" && !definition.subscription)
          return yield* new Primitive.Invalid({ message: "Only Anthropic and OpenAI have subscriptions." })
        const enabled = input.enabled ?? Option.match(current, { onNone: () => true, onSome: (row) => row.enabled })
        yield* onlyUnavailable(inference.cardState(actor, providerId, { enabled, method }))
        yield* upsert({
          organization_id: actor.organizationId,
          provider_id: providerId,
          enabled,
          method,
          key_last4: Option.match(current, { onNone: () => null, onSome: (row) => row.key_last4 }),
          key_tested_at: Option.match(current, { onNone: () => null, onSome: (row) => row.key_tested_at }),
          key_saved_by: Option.match(current, { onNone: () => null, onSome: (row) => row.key_saved_by }),
        })
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      test: Effect.fn("ProviderSettings.test")(function* (actor, providerId, fields) {
        yield* manager(actor)
        yield* definitionOf(providerId)
        return yield* onlyUnavailable(inference.testKey(actor, providerId, fields, yield* testModelOf(providerId)))
      }),
      saveKey: Effect.fn("ProviderSettings.saveKey")(function* (actor, providerId, fields) {
        yield* manager(actor)
        const definition = yield* definitionOf(providerId)
        const missing = definition.fields.filter((field) => !(field.name in fields))
        if (missing.length > 0)
          return yield* new Primitive.Invalid({ message: `Enter ${missing.map((field) => field.label).join(", ")}.` })
        const saved = yield* onlyUnavailable(
          inference.saveKey(actor, providerId, fields, yield* testModelOf(providerId)),
        )
        const current = yield* rowOf(actor.organizationId, providerId)
        const member = yield* Actor.memberOf(database.db, actor)
        yield* upsert({
          organization_id: actor.organizationId,
          provider_id: providerId,
          enabled: Option.match(current, { onNone: () => true, onSome: (row) => row.enabled }),
          method: Option.match(current, { onNone: () => "key" as const, onSome: (row) => row.method }),
          key_last4: saved.last4,
          key_tested_at: DateTime.toDateUtc(saved.testedAt),
          key_saved_by: member,
        })
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      removeKey: Effect.fn("ProviderSettings.removeKey")(function* (actor, providerId) {
        yield* manager(actor)
        yield* definitionOf(providerId)
        yield* onlyUnavailable(inference.removeKey(actor, providerId))
        yield* database.db
          .update(providers)
          .set({ key_last4: null, key_tested_at: null, key_saved_by: null, updated_at: sql`now()` })
          .where(and(eq(providers.organization_id, actor.organizationId), eq(providers.provider_id, providerId)))
          .pipe(Effect.orDie)
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      renModels,
      updateRenModels: Effect.fn("ProviderSettings.updateRenModels")(function* (actor, input) {
        yield* manager(actor)
        const snapshot = yield* catalog.current
        const known = new Set(lists.ren(snapshot).map((model) => model.info.gateway ?? model.info.id))
        const unknown = (input.models ?? []).filter((model) => !known.has(model.id))
        if (unknown.length > 0)
          return yield* new Primitive.Invalid({
            message: `Unknown Ren models: ${unknown.map((model) => model.id).join(", ")}.`,
          })
        const before = yield* renModels(actor)
        const current = yield* rowOf(actor.organizationId, ProviderCard.ren)
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            // oxlint-disable-next-line ren/no-comments -- Turning "New models on" off keeps today's models as they are: each gets its own switch, so only models that arrive later take the new state.
            if (input.newModelsOn === false && before.newModelsOn) {
              const explicit = before.models.map((model) => ({
                organization_id: actor.organizationId,
                model_id: model.id,
                enabled: model.enabled,
              }))
              if (explicit.length > 0) yield* transaction.insert(renModelRows).values(explicit).onConflictDoNothing()
            }
            for (const model of input.models ?? [])
              yield* transaction
                .insert(renModelRows)
                .values({ organization_id: actor.organizationId, model_id: model.id, enabled: model.enabled })
                .onConflictDoUpdate({
                  target: [renModelRows.organization_id, renModelRows.model_id],
                  set: { enabled: model.enabled },
                })
            yield* transaction
              .insert(providers)
              .values({
                organization_id: actor.organizationId,
                provider_id: ProviderCard.ren,
                enabled: Option.match(current, { onNone: () => true, onSome: (row) => row.enabled }),
                method: "key",
                new_models: input.newModelsOn ?? before.newModelsOn,
              })
              .onConflictDoUpdate({
                target: [providers.organization_id, providers.provider_id],
                set: { new_models: input.newModelsOn ?? before.newModelsOn, updated_at: sql`now()` },
              })
          }),
        )
        yield* tellSwitches
        yield* lists.refresh(actor.organizationId)
        return yield* renModels(actor)
      }),
      // oxlint-disable-next-line ren/no-comments -- Providers P15: a new organization starts on the deployment's default model, `<card>/<model>`. Without the setting it takes Ren's settings.
      applyDefaultModel: Effect.fn("ProviderSettings.applyDefaultModel")(function* (organizationId) {
        if (Option.isNone(defaultModel)) return
        const separator = defaultModel.value.indexOf("/")
        if (separator < 1) return yield* Effect.die(new Error("REN_DEFAULT_MODEL is <card>/<model>"))
        const encoded = yield* Schema.encodeEffect(Settings.Info)({
          model: {
            endpointId: defaultModel.value.slice(0, separator),
            modelId: defaultModel.value.slice(separator + 1),
          },
          permissions: [],
          references: [],
        }).pipe(Effect.orDie)
        yield* database.db
          .insert(Database.Schema.settings)
          .values({ organization_id: organizationId, settings: encoded })
          .onConflictDoNothing()
          .pipe(Effect.orDie)
      }),
      // oxlint-disable-next-line ren/no-comments -- Providers §10: the gateway says a seat changed; Ren reads every seat of the organization and keeps their models.
      changed: Effect.fn("ProviderSettings.changed")(function* (organizationId) {
        const seats = yield* onlyUnavailable(inference.seats(organizationId)).pipe(
          Effect.catchTag("Primitive.Invalid", (cause) =>
            Effect.fail(new RenInference.Unavailable({ message: cause.message, cause })),
          ),
        )
        const table = Database.Schema.organization_seat_models
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* transaction.delete(table).where(eq(table.organization_id, organizationId))
            if (seats.length > 0)
              yield* transaction.insert(table).values(
                seats.map((seat) => ({
                  organization_id: organizationId,
                  connection_id: seat.id,
                  vendor: seat.providerId,
                  models: [...seat.models],
                  plan: seat.plan,
                })),
              )
          }),
        )
        yield* lists.refresh(organizationId)
      }),
    })
  }),
)

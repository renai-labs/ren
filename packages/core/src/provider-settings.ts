export * as ProviderSettings from "./provider-settings.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Provider } from "@ren/schema/provider"
import { Settings } from "@ren/schema/settings"
import { eq, inArray } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { ModelLists } from "./model-lists.js"
import { ModelGateway } from "./model-gateway.js"
import { Primitive } from "./primitive.js"
import { ProviderPolicy } from "./provider-settings/policy.js"
import { RenInference } from "./ren-inference.js"

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | ModelGateway.Unavailable

type Fields = Provider.KeyInput["fields"]

export interface Interface {
  readonly page: (actor: Actor.Info) => Effect.Effect<Provider.Page, Failure>
  readonly update: (
    actor: Actor.Info,
    providerId: string,
    input: Provider.UpdateInput,
  ) => Effect.Effect<Provider.Page, Failure>
  readonly test: (actor: Actor.Info, providerId: string, fields: Fields) => Effect.Effect<Provider.TestResult, Failure>
  readonly connect: (actor: Actor.Info, providerId: string, fields: Fields) => Effect.Effect<Provider.Page, Failure>
  readonly disconnect: (actor: Actor.Info, providerId: string) => Effect.Effect<Provider.Page, Failure>
  readonly models: (actor: Actor.Info, providerId: string) => Effect.Effect<Provider.ModelList, Failure>
  readonly updateModels: (
    actor: Actor.Info,
    providerId: string,
    input: Provider.ModelListInput,
  ) => Effect.Effect<Provider.ModelList, Failure>
  readonly applyDefaultModel: (organizationId: Auth.OrganizationID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ProviderSettings") {}

const notFound = new Primitive.NotFound({ message: "Provider not found." })
const forbidden = new Primitive.Forbidden({ message: "Only organization admins and owners change providers." })

const keyFields = (provider: ModelGateway.Provider) =>
  provider.auth.flatMap((auth) => (auth._tag === "key" ? auth.fields : []))

const rejected = <A>(effect: Effect.Effect<A, ModelGateway.Unavailable | ModelGateway.Rejected>) =>
  effect.pipe(
    Effect.catchTag("ModelGateway.Rejected", (error) => Effect.fail(new Primitive.Invalid({ message: error.message }))),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const lists = yield* ModelLists.Service
    const inference = yield* RenInference.Service
    const defaultModel = yield* Config.option(Config.String("REN_DEFAULT_MODEL"))

    const canManage = (actor: Actor.Info) =>
      access.isAllowed({ actor, action: ProviderPolicy.actions.manage, resource: Access.organization })

    const viewer = (actor: Actor.Info) =>
      access.isAllowed({ actor, action: ProviderPolicy.actions.view, resource: Access.organization })
        ? Effect.void
        : Effect.fail(notFound)

    const manager = (actor: Actor.Info) => (canManage(actor) ? Effect.void : Effect.fail(forbidden))

    const ownedOf = Effect.fnUntraced(function* (providerId: string) {
      const found = (yield* lists.providers).find((each) => each.provider.id === providerId)
      if (!found) return yield* notFound
      return found
    })

    const settingsOf = Effect.fnUntraced(function* (organizationId: Auth.OrganizationID) {
      const all = yield* lists.settings(organizationId)
      return { all, stateOf: (provider: ModelGateway.Provider) => ModelLists.stateOf(provider, all[provider.id]) }
    })

    const checked = Effect.fnUntraced(function* (provider: ModelGateway.Provider, fields: Fields) {
      const wanted = keyFields(provider)
      if (wanted.length === 0) return yield* new Primitive.Invalid({ message: `${provider.name} takes no key.` })
      const missing = wanted.filter((field) => !(field.name in fields))
      if (missing.length > 0)
        return yield* new Primitive.Invalid({ message: `Enter ${missing.map((field) => field.label).join(", ")}.` })
    })

    const page = Effect.fn("ProviderSettings.page")(function* (actor: Actor.Info) {
      yield* viewer(actor)
      const owned = yield* lists.providers
      const settings = yield* settingsOf(actor.organizationId)
      // oxlint-disable-next-line ren/no-comments -- Seats come from the Ren Inference Service until the gateway gives connections (Providers §6.1). Without them the page still shows the providers.
      const seats = yield* inference.list(actor).pipe(
        Effect.tapError((error) => Effect.logWarning("The seats are unavailable for the Providers page", error)),
        Effect.orElseSucceed(() => []),
      )
      const added = (provider: ModelGateway.Provider) => provider.id in settings.all
      const savers = Object.values(settings.all).flatMap((each) => (each.key?.savedBy ? [each.key.savedBy] : []))
      const names = new Map(
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
      const onPage = [
        ...owned.filter((each) => ModelLists.builtIn(each.provider)),
        ...owned.filter((each) => !ModelLists.builtIn(each.provider) && added(each.provider)),
      ]
      const shown = yield* Effect.forEach(onPage, (each) =>
        Effect.gen(function* () {
          const state = settings.stateOf(each.provider)
          const key = settings.all[each.provider.id]?.key
          const models = yield* lists.models(actor.organizationId, each)
          return {
            id: each.provider.id,
            name: each.provider.name,
            mark: each.provider.mark,
            payer: each.provider.payer,
            builtIn: ModelLists.builtIn(each.provider),
            enabled: state.enabled,
            ...(state.method && { method: state.method }),
            methods: ModelLists.methodsOf(each.provider),
            fields: keyFields(each.provider),
            seats: seats.filter((seat) => seat.providerId === each.provider.id),
            key: key
              ? {
                  last4: key.last4,
                  testedAt: key.testedAt,
                  savedBy: key.savedBy ? { memberId: key.savedBy, name: names.get(key.savedBy) ?? null } : null,
                }
              : null,
            modelCount: models.filter((model) => !state.off.includes(ModelLists.switchId(model))).length,
            canManage: manages,
          } satisfies Provider.Info
        }),
      )
      return {
        providers: shown,
        available: owned
          .filter((each) => !ModelLists.builtIn(each.provider))
          .map((each) => ({
            id: each.provider.id,
            name: each.provider.name,
            mark: each.provider.mark,
            modelCount: each.provider.modelCount ?? 0,
            fields: keyFields(each.provider),
            added: added(each.provider),
          })),
      } satisfies Provider.Page
    })

    const models = Effect.fn("ProviderSettings.models")(function* (actor: Actor.Info, providerId: string) {
      yield* viewer(actor)
      const owned = yield* ownedOf(providerId)
      const state = (yield* settingsOf(actor.organizationId)).stateOf(owned.provider)
      return {
        canManage: canManage(actor),
        models: (yield* lists.models(actor.organizationId, owned)).map((model) => ({
          id: ModelLists.switchId(model),
          name: model.name ?? model.id,
          price: model.price,
          free: model.free === true,
          enabled: !state.off.includes(ModelLists.switchId(model)),
        })),
      } satisfies Provider.ModelList
    })

    return Service.of({
      page,
      // oxlint-disable-next-line ren/no-comments -- The gateway hears a change first, so it refuses what is off before pickers change.
      update: Effect.fn("ProviderSettings.update")(function* (actor, providerId, input) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        if (input.method && !ModelLists.methodsOf(owned.provider).includes(input.method))
          return yield* new Primitive.Invalid({ message: `${owned.provider.name} has no ${input.method} method.` })
        const current = (yield* settingsOf(actor.organizationId)).stateOf(owned.provider)
        const enabled = input.enabled ?? current.enabled
        const method = input.method ?? current.method
        yield* owned.gateway.configure(providerId, actor.organizationId, {
          enabled,
          ...(method && { method }),
          off: current.off,
        })
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      test: Effect.fn("ProviderSettings.test")(function* (actor, providerId, fields) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* checked(owned.provider, fields)
        return yield* rejected(owned.gateway.test(providerId, actor.organizationId, fields))
      }),
      connect: Effect.fn("ProviderSettings.connect")(function* (actor, providerId, fields) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* checked(owned.provider, fields)
        yield* rejected(
          owned.gateway.connect(providerId, actor.organizationId, fields, yield* Actor.memberOf(database.db, actor)),
        )
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      disconnect: Effect.fn("ProviderSettings.disconnect")(function* (actor, providerId) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* owned.gateway.disconnect(providerId, actor.organizationId)
        yield* lists.refresh(actor.organizationId)
        return yield* page(actor)
      }),
      models,
      updateModels: Effect.fn("ProviderSettings.updateModels")(function* (actor, providerId, input) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        const known = new Set((yield* lists.models(actor.organizationId, owned)).map(ModelLists.switchId))
        const unknown = input.models.filter((model) => !known.has(model.id))
        if (unknown.length > 0)
          return yield* new Primitive.Invalid({
            message: `Unknown models: ${unknown.map((model) => model.id).join(", ")}.`,
          })
        const current = (yield* settingsOf(actor.organizationId)).stateOf(owned.provider)
        const changed = new Set(input.models.map((model) => model.id))
        const off = [
          ...current.off.filter((id) => !changed.has(id)),
          ...input.models.filter((model) => !model.enabled).map((model) => model.id),
        ]
        yield* owned.gateway.configure(providerId, actor.organizationId, {
          enabled: current.enabled,
          ...(current.method && { method: current.method }),
          off,
        })
        yield* lists.refresh(actor.organizationId)
        return yield* models(actor, providerId)
      }),
      // oxlint-disable-next-line ren/no-comments -- Providers P15: a new organization starts on the deployment's default model, `<provider>/<model>`. Without the setting it takes Ren's settings.
      applyDefaultModel: Effect.fn("ProviderSettings.applyDefaultModel")(function* (organizationId) {
        if (Option.isNone(defaultModel)) return
        const separator = defaultModel.value.indexOf("/")
        if (separator < 1) return yield* Effect.die(new Error("REN_DEFAULT_MODEL is <provider>/<model>"))
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
    })
  }),
)

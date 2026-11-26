export * as ProviderSettings from "./provider-settings.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Models } from "@ren/schema/models"
import type { Provider } from "@ren/schema/provider"
import { Settings } from "@ren/schema/settings"
import { eq, inArray } from "drizzle-orm"
import { Config, Context, Effect, Layer, Option, Schema } from "effect"
import { Access } from "./access.js"
import { Actor } from "./actor.js"
import { ModelLists } from "./model-lists.js"
import { InferencePlugin } from "./inference-plugin.js"
import { Primitive } from "./primitive.js"
import { ProviderPolicy } from "./provider-settings/policy.js"
import { RenInference } from "./ren-inference.js"

export type Failure = Primitive.NotFound | Primitive.Forbidden | Primitive.Invalid | InferencePlugin.Unavailable

type Fields = Provider.KeyInput["fields"]

export interface Interface {
  readonly page: (actor: Actor.Info) => Effect.Effect<Provider.Page, Failure>
  readonly update: (actor: Actor.Info, providerId: string, input: Provider.UpdateInput) => Effect.Effect<void, Failure>
  readonly test: (actor: Actor.Info, providerId: string, fields: Fields) => Effect.Effect<Provider.TestResult, Failure>
  readonly saveKey: (actor: Actor.Info, providerId: string, fields: Fields) => Effect.Effect<void, Failure>
  readonly removeKey: (actor: Actor.Info, providerId: string) => Effect.Effect<void, Failure>
  readonly models: (actor: Actor.Info, providerId: string) => Effect.Effect<Provider.ModelList, Failure>
  readonly updateModels: (
    actor: Actor.Info,
    providerId: string,
    input: Provider.ModelListInput,
  ) => Effect.Effect<void, Failure>
  readonly applyDefaultModel: (organizationId: Auth.OrganizationID) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ProviderSettings") {}

const notFound = new Primitive.NotFound({ message: "Provider not found." })
const forbidden = new Primitive.Forbidden({ message: "Only organization admins and owners change providers." })

const keyFields = (provider: InferencePlugin.Provider) =>
  provider.auth.flatMap((auth) => (auth._tag === "key" ? auth.fields : []))

const countTypes = (models: ReadonlyArray<Models.Info>) =>
  Object.fromEntries(
    Object.entries(Object.groupBy(models, (model) => model.type)).map(([type, found]) => [type, found.length]),
  )

const rejected = <A>(effect: Effect.Effect<A, InferencePlugin.Unavailable | InferencePlugin.Rejected>) =>
  effect.pipe(
    Effect.catchTag("InferencePlugin.Rejected", (error) =>
      Effect.fail(new Primitive.Invalid({ message: error.message })),
    ),
  )

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const access = yield* Access.Service
    const lists = yield* ModelLists.Service
    const inference = yield* RenInference.Service
    // oxlint-disable-next-line ren/no-comments -- Read once when Ren starts: a bad value stops the start, not each signup.
    const defaultModel = yield* Config.option(
      Config.schema(
        Schema.String.check(Schema.isPattern(/^[^/]+\/.+$/u, { message: "REN_DEFAULT_MODEL is <provider>/<model>" })),
        "REN_DEFAULT_MODEL",
      ),
    ).pipe(
      Effect.map(
        Option.map((value) => ({
          endpointId: value.slice(0, value.indexOf("/")),
          modelId: value.slice(value.indexOf("/") + 1),
        })),
      ),
    )

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
      return { all, stateOf: (provider: InferencePlugin.Provider) => ModelLists.stateOf(provider, all[provider.id]) }
    })

    const checked = Effect.fnUntraced(function* (provider: InferencePlugin.Provider, fields: Fields) {
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
      // oxlint-disable-next-line ren/no-comments -- Seats come from the Ren Inference Service until the inference service gives connections (Providers §6.1). Without them the page still shows the providers.
      const seats = yield* inference.list(actor).pipe(
        Effect.tapError((error) => Effect.logWarning("The seats are unavailable for the Providers page", error)),
        Effect.orElseSucceed(() => []),
      )
      const added = (provider: InferencePlugin.Provider) => provider.id in settings.all
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
      const order = (each: InferencePlugin.Owned) => {
        if (ModelLists.builtIn(each.provider)) return 0
        return added(each.provider) ? 1 : 2
      }
      const providers = yield* Effect.forEach(
        owned.toSorted((left, right) => order(left) - order(right)),
        (each) =>
          Effect.gen(function* () {
            const state = settings.stateOf(each.provider)
            const key = settings.all[each.provider.id]?.key
            const shown = ModelLists.builtIn(each.provider) || added(each.provider)
            // oxlint-disable-next-line ren/no-comments -- A provider the organization did not add shows what it offers, from the inference service's list, without asking for its models.
            const modelTypes = shown
              ? countTypes(
                  (yield* lists.models(actor.organizationId, each)).filter(
                    (model) => !state.off.includes(ModelLists.switchId(model)),
                  ),
                )
              : (each.provider.modelTypes ?? { chat: each.provider.modelCount ?? 0 })
            const signIn = each.provider.auth
              .flatMap((auth) => (auth._tag === "subscription" ? [auth.signIn] : []))
              .at(0)
            return {
              id: each.provider.id,
              name: each.provider.name,
              mark: each.provider.mark,
              ...(each.provider.logo && { logo: each.provider.logo }),
              payer: each.provider.payer,
              builtIn: ModelLists.builtIn(each.provider),
              added: shown,
              enabled: state.enabled,
              ...(state.method && { method: state.method }),
              methods: ModelLists.methodsOf(each.provider),
              ...(signIn && { signIn }),
              fields: keyFields(each.provider),
              seats: seats.filter((seat) => seat.providerId === each.provider.id),
              key: key
                ? {
                    last4: key.last4,
                    testedAt: key.testedAt,
                    savedBy: key.savedBy ? { memberId: key.savedBy, name: names.get(key.savedBy) ?? null } : null,
                  }
                : null,
              modelTypes,
              canManage: manages,
            } satisfies Provider.Info
          }),
        { concurrency: 8 },
      )
      return { providers } satisfies Provider.Page
    })

    const models = Effect.fn("ProviderSettings.models")(function* (actor: Actor.Info, providerId: string) {
      yield* viewer(actor)
      const owned = yield* ownedOf(providerId)
      const state = (yield* settingsOf(actor.organizationId)).stateOf(owned.provider)
      return {
        canManage: canManage(actor),
        // oxlint-disable-next-line ren/no-comments -- The latest release first; a model without a date goes last. ISO dates sort as text.
        models: (yield* lists.models(actor.organizationId, owned))
          .toSorted((left, right) => (right.released ?? "").localeCompare(left.released ?? ""))
          .map((model) => ({
            id: ModelLists.switchId(model),
            name: model.name ?? model.id,
            type: model.type,
            input: model.input ?? ["text"],
            reasoning: (model.efforts?.length ?? 0) > 0,
            context: model.limit?.context,
            released: model.released,
            price: model.price,
            free: model.free === true,
            plans: model.plans,
            enabled: !state.off.includes(ModelLists.switchId(model)),
          })),
      } satisfies Provider.ModelList
    })

    return Service.of({
      page,
      // oxlint-disable-next-line ren/no-comments -- The inference service hears a change first, so it refuses what is off before pickers change. A write answers nothing: a page read that fails after it must not make the client send the write again.
      update: Effect.fn("ProviderSettings.update")(function* (actor, providerId, input) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        if (input.method && !ModelLists.methodsOf(owned.provider).includes(input.method))
          return yield* new Primitive.Invalid({ message: `${owned.provider.name} has no ${input.method} method.` })
        yield* rejected(owned.plugin.update(providerId, actor.organizationId, input))
        yield* lists.refresh(actor.organizationId)
      }),
      test: Effect.fn("ProviderSettings.test")(function* (actor, providerId, fields) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* checked(owned.provider, fields)
        return yield* rejected(owned.plugin.test(providerId, actor.organizationId, fields))
      }),
      saveKey: Effect.fn("ProviderSettings.saveKey")(function* (actor, providerId, fields) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* checked(owned.provider, fields)
        yield* rejected(
          owned.plugin.saveKey(providerId, actor.organizationId, fields, yield* Actor.memberOf(database.db, actor)),
        )
        yield* lists.refresh(actor.organizationId)
      }),
      removeKey: Effect.fn("ProviderSettings.removeKey")(function* (actor, providerId) {
        yield* manager(actor)
        const owned = yield* ownedOf(providerId)
        yield* rejected(owned.plugin.removeKey(providerId, actor.organizationId))
        yield* lists.refresh(actor.organizationId)
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
        yield* rejected(owned.plugin.switchModels(providerId, actor.organizationId, input.models))
        yield* lists.refresh(actor.organizationId)
      }),
      // oxlint-disable-next-line ren/no-comments -- Providers P15: a new organization starts on the deployment's default model, `<provider>/<model>`. Without the setting it takes Ren's settings.
      applyDefaultModel: Effect.fn("ProviderSettings.applyDefaultModel")(function* (organizationId) {
        if (Option.isNone(defaultModel)) return
        const encoded = yield* Schema.encodeEffect(Settings.Info)({
          model: defaultModel.value,
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

export * as ModelLists from "./model-lists.js"

import { Database } from "@ren/db/database"
import { Auth } from "@ren/schema/auth"
import { ProviderCard } from "@ren/schema/provider-card"
import { Models } from "@ren/schema/models"
import { eq, sql } from "drizzle-orm"
import { Config, Context, Duration, Effect, Layer, Option, Ref, Schedule, Schema, Struct } from "effect"
import { ModelCatalog } from "./model-catalog.js"
import { RenInference, type RenModels } from "./ren-inference.js"

export const renCard = "ren"

// oxlint-disable-next-line ren/no-comments -- A card of the Providers page as a brain gets it: its models and how they are called, without the gateway's address.
export interface Card extends Schema.Schema.Type<typeof Card> {}

export interface RenModel {
  readonly info: Models.Info
  readonly upstream: string
}

export interface Settings {
  readonly upstream: Option.Option<string>
  readonly block: ReadonlyArray<string>
}

const dashed = (id: string) => id.replaceAll(".", "-")

// oxlint-disable-next-line ren/no-comments -- Providers §6.2: chat models with tools, not deprecated, with a price, minus the block list. A paid model takes `<canonical_id>` when no other kept model claims it more exactly; a free model keeps its upstream id, so it never takes the id of the paid model it shares a canonical id with.
export const renModels = (data: ModelCatalog.Data, settings: Settings): ReadonlyArray<RenModel> => {
  const named = settings.upstream
  if (Option.isNone(named)) return []
  const upstream = data.providers.find((provider) => provider.id === named.value)
  if (!upstream) return []
  const blocked = new Set(settings.block)
  const kept = upstream.models.flatMap((model) => {
    const price = model.price
    if (model.type !== "chat" || !model.tools || model.deprecated || !price || blocked.has(model.id)) return []
    return [{ model, price, free: price.input === 0 && price.output === 0 }]
  })
  const claims = Map.groupBy(
    kept.filter((each) => !each.free && each.model.canonicalId),
    (each) => each.model.canonicalId ?? "",
  )
  const idOf = (each: (typeof kept)[number]) => {
    const canonical = each.model.canonicalId
    if (each.free || !canonical) return each.model.id
    const rivals = claims.get(canonical) ?? []
    const exact = rivals.find((rival) => dashed(rival.model.id) === dashed(canonical))
    if (rivals.length === 1 || exact === each) return canonical
    return each.model.id
  }
  const seen = new Set<string>()
  return kept.flatMap((each) => {
    const id = idOf(each)
    if (seen.has(id) || blocked.has(id)) return []
    seen.add(id)
    const claude = id.startsWith("anthropic/")
    const info: Models.Info = {
      id,
      type: "chat",
      name: each.model.name,
      ...(each.model.limit && { limit: each.model.limit }),
      ...(each.model.efforts && { efforts: each.model.efforts }),
      input: each.model.input,
      protocol: claude ? "anthropic-messages" : "openai-chat",
      gateway: `${renCard}/${id}`,
      ...(claude && { runtime: "claude" as const }),
      price: each.price,
      ...(each.free && { free: true }),
    }
    return [{ info, upstream: each.model.id }]
  })
}

export const settings = Effect.map(
  Config.all({
    upstream: Config.option(Config.String("REN_MODELS_UPSTREAM")),
    block: Config.String("REN_MODELS_BLOCK").pipe(
      Config.map((raw) =>
        raw
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
      Config.withDefault<ReadonlyArray<string>>([]),
    ),
  }),
  (found): Settings => found,
)

export const Card = Models.CatalogEndpoint.mapFields(Struct.omit(["baseUrl", "headers"]))

const encodeCards = Schema.encodeSync(Schema.Array(Card))

export const hashOf = (cards: ReadonlyArray<Card>) => Bun.hash(JSON.stringify(encodeCards(cards))).toString(16)

// oxlint-disable-next-line ren/no-comments -- What an organization changed on its Providers page; a card without a row takes its defaults.
export interface OrganizationSettings {
  readonly providers: ReadonlyArray<{
    readonly provider_id: string
    readonly enabled: boolean
    readonly method: Models.Method
    readonly new_models: boolean | null
    readonly key_last4: string | null
    readonly key_tested_at: Date | null
    readonly key_saved_by: typeof Auth.MemberID.Type | null
  }>
  readonly ren: ReadonlyArray<{ readonly model_id: string; readonly enabled: boolean }>
  readonly seats: ReadonlyArray<{ readonly vendor: string; readonly models: ReadonlyArray<string> }>
}

export const noSettings: OrganizationSettings = { providers: [], ren: [], seats: [] }

const protocolOf = (providerId: string): Models.Protocol => {
  if (providerId === "anthropic") return "anthropic-messages"
  if (providerId === "openai") return "openai-responses"
  return "openai-chat"
}

const infoOf = (model: ModelCatalog.Model, providerId: string, gateway: string): Models.Info => ({
  id: model.id,
  type: "chat",
  name: model.name,
  ...(model.limit && { limit: model.limit }),
  ...(model.efforts && { efforts: model.efforts }),
  input: model.input,
  protocol: protocolOf(providerId),
  gateway,
})

// oxlint-disable-next-line ren/no-comments -- Providers §5.2: a Ren model's own switch, else the card's "New models on". Ren off switches every Ren model off.
export const renEnabled = (settings: OrganizationSettings) => {
  const card = settings.providers.find((row) => row.provider_id === renCard)
  const switches = new Map(settings.ren.map((row) => [row.model_id, row.enabled]))
  return (gateway: string) => (card?.enabled ?? true) && (switches.get(gateway) ?? card?.new_models ?? true)
}

// oxlint-disable-next-line ren/no-comments -- A card is on when its row says so. Without a row, Anthropic and OpenAI are on with the subscription method once a member connected a seat; every other provider is off until it is added.
const cardRow = (settings: OrganizationSettings, providerId: string) =>
  settings.providers.find((row) => row.provider_id === providerId) ??
  (settings.seats.some((seat) => seat.vendor === providerId)
    ? { provider_id: providerId, enabled: true, method: "subscription" as const, key_last4: null }
    : undefined)

// oxlint-disable-next-line ren/no-comments -- Providers §6.5: Ren's card first, then each card that is on, in the order of the Providers page.
export const cardsOf = (
  data: ModelCatalog.Data,
  ren: ReadonlyArray<RenModel>,
  settings: OrganizationSettings,
): ReadonlyArray<Card> => {
  const isOn = renEnabled(settings)
  const renModelsOn = ren.map((model) => model.info).filter((info) => isOn(info.gateway ?? info.id))
  const renCards: ReadonlyArray<Card> =
    renModelsOn.length === 0 ? [] : [{ id: renCard, name: "Ren", protocol: "openai-chat", models: renModelsOn }]
  const byId = new Map(data.providers.map((provider) => [provider.id, provider]))
  const providerCards = ProviderCard.definitions.flatMap((definition): ReadonlyArray<Card> => {
    const row = cardRow(settings, definition.id)
    const provider = byId.get(definition.id)
    if (!row?.enabled || !provider) return []
    if (row.method === "key") {
      if (!row.key_last4) return []
      const models = provider.models
        .filter((model) => model.type === "chat" && !model.deprecated)
        .map((model) => infoOf(model, definition.id, `${definition.id}/${model.id}`))
      return [{ id: definition.id, name: provider.name, protocol: protocolOf(definition.id), method: "key", models }]
    }
    const listed = [
      ...new Set(settings.seats.filter((seat) => seat.vendor === definition.id).flatMap((seat) => seat.models)),
    ]
    const known = new Map(provider.models.map((model) => [model.id, model]))
    const runtime: Partial<Pick<Models.Info, "runtime">> = definition.id === "anthropic" ? { runtime: "claude" } : {}
    const models = listed.toSorted().map((id): Models.Info => {
      const gateway = `seat/${definition.id}/${id}`
      const model = known.get(id)
      return Object.assign(
        model
          ? infoOf(model, definition.id, gateway)
          : { id, type: "chat" as const, protocol: protocolOf(definition.id), gateway },
        runtime,
      )
    })
    if (models.length === 0) return []
    return [
      { id: definition.id, name: provider.name, protocol: protocolOf(definition.id), method: "subscription", models },
    ]
  })
  return [...renCards, ...providerCards]
}

export interface Interface {
  readonly ren: (snapshot: ModelCatalog.Snapshot) => ReadonlyArray<RenModel>
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<Card>>
  readonly settingsOf: (organizationId: Auth.OrganizationID) => Effect.Effect<OrganizationSettings>
  readonly revision: Effect.Effect<string>
  readonly refresh: (organizationId: Auth.OrganizationID) => Effect.Effect<boolean>
  readonly sync: Effect.Effect<{ readonly notified: number }>
  readonly switches: (snapshot: ModelCatalog.Snapshot) => Effect.Effect<RenModels["switches"]>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ModelLists") {}

const writeBatch = 1_000

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* ModelCatalog.Service
    const database = yield* Database.Service
    const found = yield* settings
    const memo = yield* Ref.make(Option.none<{ readonly revision: string; readonly ren: ReadonlyArray<RenModel> }>())
    const tables = {
      providers: Database.Schema.organization_provider,
      ren: Database.Schema.organization_ren_model,
      seats: Database.Schema.organization_seat_models,
    }

    const renOf = Effect.fnUntraced(function* (snapshot: ModelCatalog.Snapshot) {
      const cached = yield* Ref.get(memo)
      if (Option.isSome(cached) && cached.value.revision === snapshot.revision) return cached.value.ren
      const next = renModels(snapshot.data, found)
      yield* Ref.set(memo, Option.some({ revision: snapshot.revision, ren: next }))
      return next
    })

    // oxlint-disable-next-line ren/no-comments -- Every organization's settings at once, for the list job; or one organization's.
    const load = Effect.fnUntraced(function* (organizationId: Option.Option<Auth.OrganizationID>) {
      const [providers, ren, seats] = yield* Effect.all(
        [
          database.db
            .select()
            .from(tables.providers)
            .where(
              Option.isSome(organizationId) ? eq(tables.providers.organization_id, organizationId.value) : undefined,
            ),
          database.db
            .select()
            .from(tables.ren)
            .where(Option.isSome(organizationId) ? eq(tables.ren.organization_id, organizationId.value) : undefined),
          database.db
            .select()
            .from(tables.seats)
            .where(Option.isSome(organizationId) ? eq(tables.seats.organization_id, organizationId.value) : undefined),
        ],
        { concurrency: "unbounded" },
      ).pipe(Effect.orDie)
      const byOrganization = new Map<Auth.OrganizationID, OrganizationSettings>()
      const of = (id: Auth.OrganizationID) => byOrganization.get(id) ?? noSettings
      for (const row of providers)
        byOrganization.set(row.organization_id, {
          ...of(row.organization_id),
          providers: [...of(row.organization_id).providers, row],
        })
      for (const row of ren)
        byOrganization.set(row.organization_id, {
          ...of(row.organization_id),
          ren: [...of(row.organization_id).ren, row],
        })
      for (const row of seats)
        byOrganization.set(row.organization_id, {
          ...of(row.organization_id),
          seats: [...of(row.organization_id).seats, row],
        })
      return byOrganization
    })

    const settingsOf = Effect.fn("ModelLists.settingsOf")(function* (organizationId: Auth.OrganizationID) {
      return (yield* load(Option.some(organizationId))).get(organizationId) ?? noSettings
    })

    const cardsFor = Effect.fnUntraced(function* (organizationSettings: OrganizationSettings) {
      const snapshot = yield* catalog.current
      return cardsOf(snapshot.data, yield* renOf(snapshot), organizationSettings)
    })

    // oxlint-disable-next-line ren/no-comments -- P26: a hash is written only when it changed; the table's trigger notifies just those organizations, never 'all'.
    const write = (rows: ReadonlyArray<{ readonly organization_id: Auth.OrganizationID; readonly hash: string }>) =>
      Effect.forEach(
        Array.from({ length: Math.ceil(rows.length / writeBatch) }, (_, index) =>
          rows.slice(index * writeBatch, (index + 1) * writeBatch),
        ),
        (batch) =>
          database.db
            .insert(Database.Schema.organization_model_list)
            .values([...batch])
            .onConflictDoUpdate({
              target: Database.Schema.organization_model_list.organization_id,
              set: { hash: sql`excluded.hash`, updated_at: sql`now()` },
              setWhere: sql`${Database.Schema.organization_model_list.hash} is distinct from excluded.hash`,
            })
            .returning({ organizationId: Database.Schema.organization_model_list.organization_id })
            .pipe(Effect.orDie),
      ).pipe(Effect.map((written) => written.flat().length))

    return Service.of({
      ren: (snapshot) => renModels(snapshot.data, found),
      list: Effect.fn("ModelLists.list")(function* (organizationId) {
        return yield* cardsFor(yield* settingsOf(organizationId))
      }),
      settingsOf,
      revision: Effect.map(catalog.current, (snapshot) => snapshot.revision),
      refresh: Effect.fn("ModelLists.refresh")(function* (organizationId) {
        const hash = hashOf(yield* cardsFor(yield* settingsOf(organizationId)))
        return (yield* write([{ organization_id: organizationId, hash }])) > 0
      }),
      sync: Effect.fn("ModelLists.sync")(function* () {
        const organizations = yield* database.db
          .select({ id: Database.Schema.organization.id })
          .from(Database.Schema.organization)
          .pipe(Effect.orDie)
        const all = yield* load(Option.none())
        const hashes = new Map<string, string>()
        const rows = yield* Effect.forEach(organizations, (organization) =>
          Effect.gen(function* () {
            const id = Auth.OrganizationID.make(organization.id)
            const organizationSettings = all.get(id) ?? noSettings
            const key = JSON.stringify(organizationSettings)
            const hash = hashes.get(key) ?? hashOf(yield* cardsFor(organizationSettings))
            hashes.set(key, hash)
            return { organization_id: id, hash }
          }),
        )
        return { notified: yield* write(rows) }
      })(),
      // oxlint-disable-next-line ren/no-comments -- The gateway refuses a Ren model an organization switched off (gate `model_off`).
      switches: Effect.fn("ModelLists.switches")(function* (snapshot) {
        const ids = (yield* renOf(snapshot)).map((model) => model.info.gateway ?? model.info.id)
        const all = yield* load(Option.none())
        return [...all].flatMap(([organizationId, organizationSettings]) => {
          const isOn = renEnabled(organizationSettings)
          const off = ids.filter((id) => !isOn(id))
          return off.length === 0 ? [] : [{ organizationId, off }]
        })
      }),
    })
  }),
)

export const refreshEvery = Duration.minutes(5)

// oxlint-disable-next-line ren/no-comments -- Providers §6.2: the gateway learns Ren's models before any picker can show them.
export const tell = Effect.fn("ModelLists.tell")(function* (snapshot: ModelCatalog.Snapshot) {
  const inference = yield* RenInference.Service
  const lists = yield* Service
  yield* inference.renModels({
    revision: snapshot.revision,
    models: lists.ren(snapshot).map((model) => ({
      id: model.info.gateway ?? model.info.id,
      upstream: model.upstream,
      price: model.info.price ?? { input: 0, output: 0 },
      free: model.info.free === true,
    })),
    switches: yield* lists.switches(snapshot),
  })
})

// oxlint-disable-next-line ren/no-comments -- A new copy of models.dev: tell the gateway, store the copy only after it answered, then notify the organizations whose list changed.
export const publish = Effect.fn("ModelLists.publish")(function* (
  snapshot: ModelCatalog.Snapshot,
  etag: Option.Option<string>,
) {
  const catalog = yield* ModelCatalog.Service
  const lists = yield* Service
  yield* tell(snapshot)
  yield* catalog.store(snapshot, etag)
  return yield* lists.sync
})

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: read models.dev every 5 minutes (MODELS_DEV_REFRESH) with its ETag. At start the gateway hears the current list again, and organizations without a hash get one.
export const layerJob = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* ModelCatalog.Service
    const lists = yield* Service
    const every = yield* Config.Duration("MODELS_DEV_REFRESH").pipe(Config.withDefault(refreshEvery))
    const context = yield* Effect.context<RenInference.Service | ModelCatalog.Service | Service>()
    const start = Effect.gen(function* () {
      yield* tell(yield* catalog.current)
      yield* lists.sync
    })
    const tick = Effect.gen(function* () {
      const fetched = yield* catalog.fetch
      if (fetched._tag === "Unchanged") return
      const synced = yield* publish(fetched.snapshot, fetched.etag)
      yield* Effect.logInfo(`models.dev changed: ${synced.notified} organizations notified`)
    })
    yield* start.pipe(
      Effect.retry(Schedule.spaced(Duration.seconds(30))),
      Effect.andThen(
        tick.pipe(
          Effect.catch((error) => Effect.logWarning("The model catalog keeps its last copy", error)),
          Effect.repeat(Schedule.spaced(every)),
        ),
      ),
      Effect.provide(context),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )
  }),
)

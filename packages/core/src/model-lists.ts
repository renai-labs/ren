export * as ModelLists from "./model-lists.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import { Models } from "@ren/schema/models"
import { sql } from "drizzle-orm"
import { Config, Context, Duration, Effect, Layer, Option, Ref, Schedule, Schema, Struct } from "effect"
import { ModelCatalog } from "./model-catalog.js"
import { RenInference } from "./ren-inference.js"

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

export interface Interface {
  readonly ren: (snapshot: ModelCatalog.Snapshot) => ReadonlyArray<RenModel>
  readonly list: (organizationId: Auth.OrganizationID) => Effect.Effect<ReadonlyArray<Card>>
  readonly revision: Effect.Effect<string>
  readonly sync: Effect.Effect<{ readonly notified: number }>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ModelLists") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* ModelCatalog.Service
    const database = yield* Database.Service
    const found = yield* settings
    const memo = yield* Ref.make(Option.none<{ readonly revision: string; readonly cards: ReadonlyArray<Card> }>())

    const cards = Effect.gen(function* () {
      const snapshot = yield* catalog.current
      const cached = yield* Ref.get(memo)
      if (Option.isSome(cached) && cached.value.revision === snapshot.revision) return cached.value.cards
      const ren = renModels(snapshot.data, found)
      const next: ReadonlyArray<Card> =
        ren.length === 0
          ? []
          : [{ id: renCard, name: "Ren", protocol: "openai-chat", models: ren.map((model) => model.info) }]
      yield* Ref.set(memo, Option.some({ revision: snapshot.revision, cards: next }))
      return next
    })

    return Service.of({
      ren: (snapshot) => renModels(snapshot.data, found),
      list: Effect.fn("ModelLists.list")(function* () {
        return yield* cards
      }),
      revision: Effect.map(catalog.current, (snapshot) => snapshot.revision),
      // oxlint-disable-next-line ren/no-comments -- P26: each organization's hash is written only when it changed; the table's trigger notifies just those organizations, never 'all'.
      sync: Effect.fn("ModelLists.sync")(function* () {
        const hash = hashOf(yield* cards)
        const list = Database.Schema.organization_model_list
        const organization = Database.Schema.organization
        const written = yield* database.db
          .insert(list)
          .select(
            database.db
              .select({ organization_id: organization.id, hash: sql<string>`${hash}::text`.as("hash") })
              .from(organization),
          )
          .onConflictDoUpdate({
            target: list.organization_id,
            set: { hash: sql`excluded.hash`, updated_at: sql`now()` },
            setWhere: sql`${list.hash} is distinct from excluded.hash`,
          })
          .returning({ organizationId: list.organization_id })
          .pipe(Effect.orDie)
        return { notified: written.length }
      })(),
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
    switches: [],
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

// oxlint-disable-next-line ren/no-comments -- Providers §6.1: read models.dev every 5 minutes with its ETag. At start the gateway hears the current list again, and organizations without a hash get one.
export const layerJob = Layer.effectDiscard(
  Effect.gen(function* () {
    const catalog = yield* ModelCatalog.Service
    const lists = yield* Service
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
          Effect.repeat(Schedule.spaced(refreshEvery)),
        ),
      ),
      Effect.provide(context),
      Effect.withErrorReporting,
      Effect.forkScoped,
    )
  }),
)

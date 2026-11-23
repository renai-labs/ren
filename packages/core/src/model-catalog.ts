export * as ModelCatalog from "./model-catalog.js"

import { Database } from "@ren/db/database"
import { Models } from "@ren/schema/models"
import { eq } from "drizzle-orm"
import { Clock, Config, Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export const source = "models.dev"

export const url = "https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image,video"

// oxlint-disable-next-line ren/no-comments -- Providers P5: the OpenCode Console's 35 providers, by their models.dev ids. Ren's upstream (REN_MODELS_UPSTREAM) is kept as well.
export const offered = [
  "anthropic",
  "openai",
  "google",
  "azure",
  "amazon-bedrock",
  "google-vertex",
  "xai",
  "meta",
  "zai",
  "deepseek",
  "nvidia",
  "minimax",
  "moonshotai",
  "alibaba",
  "cohere",
  "baseten",
  "cerebras",
  "chutes",
  "cloudflare-ai-gateway",
  "databricks",
  "deepinfra",
  "digitalocean",
  "fireworks-ai",
  "groq",
  "togetherai",
  "thinkingmachines",
  "huggingface",
  "mistral",
  "openrouter",
  "poolside",
  "siliconflow",
  "vultr",
  "venice",
  "vercel",
  "xiaomi",
] as const

export interface Model extends Schema.Schema.Type<typeof Model> {}
export const Model = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  canonicalId: Schema.optionalKey(Schema.NonEmptyString),
  type: Models.Type,
  tools: Schema.Boolean,
  deprecated: Schema.Boolean,
  input: Schema.Array(Models.Modality),
  limit: Schema.optionalKey(Models.Info.fields.limit),
  efforts: Schema.optionalKey(Schema.Array(Schema.NonEmptyString)),
  price: Schema.optionalKey(Models.Price),
}).annotate({ identifier: "ModelCatalog.Model" })

export interface Provider extends Schema.Schema.Type<typeof Provider> {}
export const Provider = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  models: Schema.Array(Model),
}).annotate({ identifier: "ModelCatalog.Provider" })

export interface Data extends Schema.Schema.Type<typeof Data> {}
export const Data = Schema.Struct({ providers: Schema.Array(Provider) }).annotate({ identifier: "ModelCatalog.Data" })

export interface Snapshot {
  readonly revision: string
  readonly data: Data
}

export type Fetched =
  | { readonly _tag: "Unchanged" }
  | { readonly _tag: "Changed"; readonly snapshot: Snapshot; readonly etag: Option.Option<string> }

export class Unavailable extends Schema.TaggedError<Unavailable>()("ModelCatalog.Unavailable", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

export interface Interface {
  readonly current: Effect.Effect<Snapshot>
  readonly fetch: Effect.Effect<Fetched, Unavailable>
  readonly store: (snapshot: Snapshot, etag: Option.Option<string>) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@ren/core/ModelCatalog") {}

const RawCost = Schema.Struct({
  input: Schema.optional(
    Schema.Struct({
      price: Schema.optional(Schema.Number),
      cache: Schema.optional(
        Schema.Struct({
          read: Schema.optional(Schema.Number),
          write: Schema.optional(Schema.Union([Schema.Number, Schema.Record(Schema.String, Schema.Number)])),
        }),
      ),
    }),
  ),
  output: Schema.optional(Schema.Struct({ price: Schema.optional(Schema.Number) })),
})

const RawModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  canonical_id: Schema.optional(Schema.NullOr(Schema.String)),
  type: Schema.String,
  status: Schema.optional(Schema.NullOr(Schema.String)),
  modalities: Schema.optional(Schema.Struct({ input: Schema.optional(Schema.Array(Schema.String)) })),
  capabilities: Schema.optional(
    Schema.Struct({
      tools: Schema.optional(Schema.Struct({ supported: Schema.optional(Schema.Boolean) })),
      reasoning: Schema.optional(
        Schema.Struct({
          supported: Schema.optional(Schema.Boolean),
          effort: Schema.optional(Schema.Array(Schema.String)),
        }),
      ),
    }),
  ),
  limit: Schema.optional(
    Schema.Struct({ context: Schema.optional(Schema.Number), output: Schema.optional(Schema.Number) }),
  ),
  cost: Schema.optional(Schema.Struct({ text: Schema.optional(RawCost) })),
})

const RawProvider = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  models: Schema.Record(Schema.String, Schema.Unknown),
})

const decodeAll = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))
const decodeProvider = Schema.decodeUnknownOption(RawProvider)
const decodeModel = Schema.decodeUnknownOption(RawModel)

const modality = (mime: string): Option.Option<Models.Modality> => {
  if (mime === "text") return Option.some("text")
  if (mime === "application/pdf" || mime === "pdf") return Option.some("pdf")
  const kind = mime.split("/").at(0)
  if (kind === "image" || kind === "audio" || kind === "video") return Option.some(kind)
  return Option.none()
}

const isPrice = (value: unknown): value is number => typeof value === "number" && value >= 0

const isLimit = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value > 0

// oxlint-disable-next-line ren/no-comments -- A price of 0 is a free model, so presence is a type check, not truthiness. A cache write priced per lifetime takes the 5-minute one.
const cacheWriteOf = (write: number | Readonly<Record<string, number>> | undefined) =>
  typeof write === "object" ? (write["5m"] ?? Object.values(write).at(0)) : write

const priceOf = (cost: typeof RawCost.Type | undefined): Option.Option<Models.Price> => {
  const input = cost?.input
  const output = cost?.output?.price
  if (!input || !isPrice(input.price) || !isPrice(output)) return Option.none()
  const cacheWrite = cacheWriteOf(input.cache?.write)
  return Option.some({
    input: input.price,
    output,
    ...(isPrice(input.cache?.read) && { cacheRead: input.cache.read }),
    ...(isPrice(cacheWrite) && { cacheWrite }),
  })
}

const limitOf = (limit: (typeof RawModel.Type)["limit"]): Option.Option<NonNullable<Model["limit"]>> => {
  const context = limit?.context
  const output = limit?.output
  return isLimit(context) && isLimit(output) ? Option.some({ context, output }) : Option.none()
}

const decodeType = Schema.decodeUnknownOption(Models.Type)

const inputOf = (mimes: ReadonlyArray<string> = ["text"]) => [
  ...new Set(mimes.flatMap((mime) => Option.toArray(modality(mime)))),
]

const effortsOf = (efforts: ReadonlyArray<string> = []) => efforts.filter((effort) => effort.length > 0)

const normalizeModel = (raw: typeof RawModel.Type): Option.Option<Model> =>
  Option.map(
    Option.filter(decodeType(raw.type), () => raw.id.length > 0 && raw.name.length > 0),
    (type): Model => {
      const efforts = effortsOf(raw.capabilities?.reasoning?.effort)
      const limit = limitOf(raw.limit)
      const price = priceOf(raw.cost?.text)
      return {
        id: raw.id,
        name: raw.name,
        ...(raw.canonical_id && { canonicalId: raw.canonical_id }),
        type,
        tools: raw.capabilities?.tools?.supported === true,
        deprecated: raw.status === "deprecated",
        input: inputOf(raw.modalities?.input),
        ...(Option.isSome(limit) && { limit: limit.value }),
        ...(efforts.length > 0 && { efforts }),
        ...(Option.isSome(price) && { price: price.value }),
      }
    },
  )

// oxlint-disable-next-line ren/no-comments -- Only the providers Ren offers are kept (P9); models.dev lists more than 300.
export const normalize = (raw: unknown, keep: ReadonlyArray<string>): Data => {
  const all = Option.getOrElse(decodeAll(raw), (): Readonly<Record<string, unknown>> => ({}))
  const providers = keep.flatMap((id) =>
    Option.toArray(decodeProvider(all[id])).map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: Object.values(provider.models)
        .flatMap((model) => Option.toArray(Option.flatMap(decodeModel(model), normalizeModel)))
        .toSorted((left, right) => left.id.localeCompare(right.id)),
    })),
  )
  return { providers }
}

const encodeData = Schema.encodeSync(Data)

export const revisionOf = (data: Data) => Bun.hash(JSON.stringify(encodeData(data))).toString(16)

const decodeData = Schema.decodeUnknownSync(Data)

// oxlint-disable-next-line ren/no-comments -- The copy Ren uses at start until the list job stores one (`script/model-catalog-snapshot.ts` writes it).
export const bundled: Effect.Effect<Snapshot> = Effect.promise(() =>
  Bun.file(new URL("./model-catalog/snapshot.json", import.meta.url)).json(),
).pipe(
  Effect.map((raw) => {
    const data = decodeData(raw)
    return { revision: revisionOf(data), data }
  }),
  Effect.cached,
  Effect.runSync,
)

export const keptProviders = Effect.map(
  Config.option(Config.String("REN_MODELS_UPSTREAM")),
  (upstream): ReadonlyArray<string> => [...new Set<string>([...offered, ...Option.toArray(upstream)])],
)

// oxlint-disable-next-line ren/no-comments -- Every instance reads the shared copy's revision, at most every few seconds, so a pull on any instance serves the copy that the list job stored.
const revisionCheckMillis = 5_000

export const layerModelsDev = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const http = yield* HttpClient.HttpClient
    const address = yield* Config.String("MODELS_DEV_URL").pipe(Config.withDefault(url))
    const keep = yield* keptProviders
    const table = Database.Schema.model_catalog
    const cached = yield* Ref.make<{ readonly snapshot: Snapshot; readonly checkedAt: number }>({
      snapshot: yield* bundled,
      checkedAt: Number.NEGATIVE_INFINITY,
    })
    const stored = database.db
      .select({ etag: table.etag, revision: table.revision })
      .from(table)
      .where(eq(table.source, source))
      .pipe(
        Effect.orDie,
        Effect.map((rows) => Option.fromNullishOr(rows.at(0))),
      )

    const current = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const found = yield* Ref.get(cached)
      if (now - found.checkedAt < revisionCheckMillis) return found.snapshot
      const row = yield* stored
      if (Option.isNone(row) || row.value.revision === found.snapshot.revision) {
        yield* Ref.set(cached, { snapshot: found.snapshot, checkedAt: now })
        return found.snapshot
      }
      const loaded = (yield* database.db
        .select({ revision: table.revision, data: table.data })
        .from(table)
        .where(eq(table.source, source))
        .pipe(Effect.orDie)).at(0)
      const next = loaded ? { revision: loaded.revision, data: decodeData(loaded.data) } : found.snapshot
      yield* Ref.set(cached, { snapshot: next, checkedAt: now })
      return next
    })

    return Service.of({
      current,
      fetch: Effect.fn("ModelCatalog.fetch")(function* () {
        const row = yield* stored
        const etag = Option.flatMap(row, (found) => Option.fromNullishOr(found.etag))
        const response = yield* http
          .execute(
            HttpClientRequest.get(address).pipe(
              HttpClientRequest.acceptJson,
              Option.isSome(etag) ? HttpClientRequest.setHeader("if-none-match", etag.value) : (self) => self,
            ),
          )
          .pipe(
            Effect.timeout("60 seconds"),
            Effect.mapError((cause) => new Unavailable({ message: "models.dev did not answer.", cause })),
          )
        if (response.status === 304) return { _tag: "Unchanged" } as const
        if (response.status !== 200)
          return yield* new Unavailable({ message: `models.dev answered ${response.status}.` })
        const raw = yield* response.json.pipe(
          Effect.mapError((cause) => new Unavailable({ message: "models.dev sent no JSON.", cause })),
        )
        const data = normalize(raw, keep)
        if (data.providers.length === 0) return yield* new Unavailable({ message: "models.dev listed no provider." })
        const next = { revision: revisionOf(data), data }
        const answered = Option.fromNullishOr(response.headers["etag"])
        if (Option.isSome(row) && row.value.revision === next.revision) {
          yield* database.db
            .update(table)
            .set({ etag: Option.getOrNull(answered), fetched_at: new Date(yield* Clock.currentTimeMillis) })
            .where(eq(table.source, source))
            .pipe(Effect.orDie)
          return { _tag: "Unchanged" } as const
        }
        return { _tag: "Changed", snapshot: next, etag: answered } as const
      })(),
      store: Effect.fn("ModelCatalog.store")(function* (next, etag) {
        const now = yield* Clock.currentTimeMillis
        const values = {
          etag: Option.getOrNull(etag),
          revision: next.revision,
          data: encodeData(next.data),
          fetched_at: new Date(now),
        }
        yield* database.db
          .insert(table)
          .values({ source, ...values })
          .onConflictDoUpdate({ target: table.source, set: values })
          .pipe(Effect.orDie)
        yield* Ref.set(cached, { snapshot: next, checkedAt: now })
      }),
    })
  }),
)

// oxlint-disable-next-line ren/no-comments -- A catalog that never changes unless a test sets it: for tests and for a Ren without models.dev.
export const layerFixture = (data: Data) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const state = yield* Ref.make<Snapshot>({ revision: revisionOf(data), data })
      return Service.of({
        current: Ref.get(state),
        fetch: Effect.succeed({ _tag: "Unchanged" }),
        store: (next) => Ref.set(state, next),
      })
    }),
  )

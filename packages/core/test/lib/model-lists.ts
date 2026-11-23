export * as ModelListsTest from "./model-lists.js"

import { PgClient } from "@effect/sql-pg"
import { ConfigProvider, Effect, Layer, Queue } from "effect"
import type { SqlError } from "effect/sql/SqlError"
import { BrainPush } from "../../src/brain-push.js"
import { ModelCatalog } from "../../src/model-catalog.js"
import { ModelLists } from "../../src/model-lists.js"

export const model = (id: string, fields: Partial<ModelCatalog.Model> = {}): ModelCatalog.Model => ({
  id,
  name: id,
  type: "chat",
  tools: true,
  deprecated: false,
  input: ["text"],
  limit: { context: 200_000, output: 32_000 },
  price: { input: 1, output: 4 },
  ...fields,
})

export const upstream = "upstream-test"

export const data = (models: ReadonlyArray<ModelCatalog.Model>, other: ReadonlyArray<ModelCatalog.Model> = []) => ({
  providers: [
    { id: upstream, name: "Upstream", models },
    { id: "groq", name: "Groq", models: other },
  ],
})

export const listening = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  const notifications = yield* pg.listen(BrainPush.channel)
  const until = (seen: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>, SqlError> =>
    Queue.take(notifications).pipe(
      Effect.flatMap((next) => (next.payload === "barrier" ? Effect.succeed(seen) : until([...seen, next.payload]))),
    )
  return { collect: pg.notify(BrainPush.channel, "barrier").pipe(Effect.andThen(until([])), Effect.orDie) }
})

export const layer = (initial: ModelCatalog.Data) =>
  ModelLists.layer.pipe(
    Layer.provideMerge(ModelCatalog.layerFixture(initial)),
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ REN_MODELS_UPSTREAM: upstream }))),
  )

import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Effect, Option } from "effect"
import { Database } from "@ren/db/database"
import { ModelCatalog } from "../src/model-catalog.js"
import { ModelLists } from "../src/model-lists.js"
import { testEffect } from "./lib/effect.js"
import { ModelListsTest } from "./lib/model-lists.js"

const it = testEffect(Testing.layer)

const organizations = 2_000

// oxlint-disable-next-line ren/no-comments -- Gate GR3 (Providers §13.1): a models.dev change under load notifies each organization whose list changed, once, and no other; never every brain.
describe("ModelLists.sync with many organizations (gate GR3)", () => {
  it.live(
    "a new Groq model wakes exactly the organizations that use Groq",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const ids = Array.from({ length: organizations }, () => Auth.OrganizationID.create())
        yield* database.db
          .insert(Database.Schema.organization)
          .values(ids.map((id) => ({ id, name: "Load", slug: id.toLowerCase(), createdAt: new Date() })))
        const groq = new Set(ids.filter((_, index) => index % 2 === 0))
        yield* database.db.insert(Database.Schema.organization_provider).values(
          [...groq].map((organization_id) => ({
            organization_id,
            provider_id: "groq",
            enabled: true,
            method: "key" as const,
            key_last4: "1111",
          })),
        )
        const listener = yield* ModelListsTest.listening
        yield* Effect.gen(function* () {
          const lists = yield* ModelLists.Service
          const catalog = yield* ModelCatalog.Service
          yield* lists.sync
          yield* listener.collect
          const next = ModelListsTest.data([ModelListsTest.model("vendor/first")], [ModelListsTest.model("llama-new")])
          yield* catalog.store({ revision: ModelCatalog.revisionOf(next), data: next }, Option.none())
          const synced = yield* lists.sync
          const seen = yield* listener.collect
          expect(synced.notified).toBe(groq.size)
          expect(new Set(seen)).toEqual(new Set([...groq].map((id) => `org:${id}`)))
          expect(seen).toHaveLength(groq.size)
        }).pipe(
          Effect.provide(
            ModelListsTest.layer(
              ModelListsTest.data([ModelListsTest.model("vendor/first")], [ModelListsTest.model("llama-old")]),
            ),
          ),
        )
      }),
    60_000,
  )
})

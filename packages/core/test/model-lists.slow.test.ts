import { describe, expect } from "bun:test"
import { Testing } from "@ren/db/testing"
import { Auth } from "@ren/schema/auth"
import { Effect } from "effect"
import { ModelLists } from "../src/model-lists.js"
import { testEffect } from "./lib/effect.js"
import { TestModelGateway } from "./lib/model-gateway.js"
import { ModelListsTest } from "./lib/model-lists.js"

const it = testEffect(Testing.layer)

const organizations = 2_000

// oxlint-disable-next-line ren/no-comments -- Gate GR3 (Providers §13.1): a change for every organization, under load, notifies each organization the gateway names once, and no other; never every brain.
describe("ModelLists.changed with many organizations (gate GR3)", () => {
  it.live(
    "a change of Groq's models notifies exactly the organizations that have Groq on",
    () =>
      Effect.gen(function* () {
        const ids = Array.from({ length: organizations }, () => Auth.OrganizationID.create())
        const groq = ids.filter((_, index) => index % 2 === 0)
        const test = yield* TestModelGateway.make({ providers: [TestModelGateway.provider("groq")] })
        yield* test.setOrganizations("groq", groq)
        const listener = yield* ModelListsTest.listening
        yield* Effect.gen(function* () {
          yield* listener.collect
          const changed = yield* ModelLists.Service.use((lists) => lists.changed({ provider: "groq" }))
          const seen = yield* listener.collect
          expect(changed.notified).toBe(groq.length)
          expect(seen).toHaveLength(groq.length)
          expect(new Set(seen)).toEqual(new Set(groq.map((id) => `org:${id}`)))
        }).pipe(Effect.provide(ModelListsTest.layer(test.gateway)))
      }),
    60_000,
  )
})

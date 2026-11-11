import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Brain } from "@ren/schema/brain"
import { eq } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { BrainProvider } from "../src/brain-provider.js"
import { EnvironmentProvider } from "../src/environment-provider.js"
import { ProviderCheck } from "../src/provider-check.js"
import { testEffect } from "./lib/effect.js"
import { TestProvider } from "./lib/environment-provider.js"
import { Seed } from "./lib/seed.js"

const brains = Effect.map(TestProvider.make({ id: "brains" }), (probe) => probe.provider)

const it = testEffect(
  Layer.mergeAll(BrainProvider.layer([brains]), EnvironmentProvider.layer<never, never>([])).pipe(
    Layer.provideMerge(Testing.layer),
  ),
)

describe("ProviderCheck", () => {
  it.live("Ren does not start when a brain runs on a provider it does not register, and says which it has", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const organizationId = yield* Seed.organization()
      const brainId = Brain.ID.create()
      yield* database.db.insert(Database.Schema.brain).values({
        id: brainId,
        organization_id: organizationId,
        space_id: yield* Seed.space(organizationId),
        scope: "space",
        provider: "brains",
      })
      yield* ProviderCheck.run
      yield* database.db
        .update(Database.Schema.brain)
        .set({ provider: "gone" })
        .where(eq(Database.Schema.brain.id, brainId))
      expect((yield* Effect.flip(ProviderCheck.run)).message).toBe(
        "Brains run on the providers gone, which this Ren does not register; it has brains",
      )
    }),
  )
})

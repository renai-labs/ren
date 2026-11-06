import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
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
  it.live(
    "Ren does not start when a space names a brain provider it does not register, and says which it has (EN24, chaos row 40)",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const spaceId = yield* Seed.space(yield* Seed.organization())
        yield* ProviderCheck.run
        yield* database.db
          .update(Database.Schema.space)
          .set({ brain_provider: "gone" })
          .where(eq(Database.Schema.space.id, spaceId))
        expect((yield* Effect.flip(ProviderCheck.run)).message).toBe(
          "Spaces name the brain providers gone, which this Ren does not register; it has brains",
        )
      }),
  )
})

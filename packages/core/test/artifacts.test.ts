import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Artifact } from "@ren/schema/artifact"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { ArtifactWorkerd } from "../src/artifact-provider/workerd.js"
import { Artifacts } from "../src/artifacts.js"
import { testEffect } from "./lib/effect.js"
import { Seed } from "./lib/seed.js"

const it = testEffect(Testing.layer)

describe("artifact provider state", () => {
  it.live("a save that lost a race fails as retryable and keeps the newer state", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const id = Artifact.ID.make(`art_${crypto.randomUUID().replaceAll("-", "")}`)
      const table = Database.Schema.artifact
      yield* database.db.insert(table).values({
        id,
        organization_id: owner.organizationId,
        space_id: owner.spaceId,
        title: "Race",
        provider: ArtifactWorkerd.id,
      })
      const first = yield* Artifacts.remoteStore(database, id, 0)
      const second = yield* Artifacts.remoteStore(database, id, 0)
      yield* first.save({ by: "first" })
      const lost = yield* second.save({ by: "second" }).pipe(Effect.flip)
      const row = (yield* database.db.select().from(table).where(eq(table.id, id))).at(0)
      expect([lost.retryable, row?.remote, row?.remote_version]).toEqual([true, { by: "first" }, 1])
    }),
  )
})

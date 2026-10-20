import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Agent } from "@ren/schema/agent"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { SettingsRows } from "../../src/settings/rows.js"
import { testEffect } from "../lib/effect.js"
import { Seed } from "../lib/seed.js"

const it = testEffect(Testing.layer)

const empty = { permissions: [], references: [] }

describe("SettingsRows", () => {
  it.live("an org, a space, an agent and Ren each have one settings row, and a write replaces it", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const owner = yield* Seed.owner()
      const agentId = Agent.ID.create()
      yield* database.db.insert(Database.Schema.agent).values({
        id: agentId,
        organization_id: owner.organizationId,
        owner_space_id: owner.spaceId,
        name: "build",
        is_subagent: false,
      })
      const owners: ReadonlyArray<SettingsRows.Owner> = [
        { organization_id: owner.organizationId },
        { space_id: owner.spaceId },
        { agent_id: agentId },
        SettingsRows.ren,
      ]
      for (const each of owners) {
        yield* database.transaction((transaction) =>
          Effect.gen(function* () {
            yield* SettingsRows.write(transaction, each, { ...empty, instructions: "First." })
            yield* SettingsRows.write(transaction, each, { ...empty, instructions: "Second." })
          }),
        )
        expect(
          (yield* Effect.flip(database.db.insert(Database.Schema.settings).values({ ...each, settings: empty })))._tag,
        ).toBe("EffectDrizzleQueryError")
      }
      const instructions = Effect.map(database.db.select().from(Database.Schema.settings), (rows) =>
        Object.fromEntries(rows.map((row) => [row.owner_id, row.settings.instructions])),
      )
      expect(yield* instructions).toEqual({
        [owner.organizationId]: "Second.",
        [owner.spaceId]: "Second.",
        [agentId]: "Second.",
        ren: "Second.",
      })
      yield* database.db.delete(Database.Schema.space).where(eq(Database.Schema.space.id, owner.spaceId))
      expect(yield* instructions).toEqual({ [owner.organizationId]: "Second.", ren: "Second." })
    }),
  )

  it.live("two references with the same alias are refused", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const docs = { alias: "docs", repository: "acme/docs" }
      const refused = yield* Effect.flip(
        database.transaction((transaction) =>
          SettingsRows.write(transaction, SettingsRows.ren, {
            permissions: [],
            references: [docs, { ...docs, branch: "main" }],
          }),
        ),
      )
      expect(refused).toMatchObject({ _tag: "Primitive.Conflict", message: "Two references use the alias docs." })
    }),
  )
})

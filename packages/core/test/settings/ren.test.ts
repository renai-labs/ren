import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { Testing } from "@ren/db/testing"
import { Label } from "@ren/schema/label"
import { asc, isNull } from "drizzle-orm"
import { Effect } from "effect"
import { RenSettings } from "../../src/settings/ren.js"
import { testEffect } from "../lib/effect.js"

const it = testEffect(Testing.layer)

const settings = (instructions: string) => ({ instructions, permissions: [], references: [] })

const apply = (defaults: RenSettings.Defaults) =>
  Effect.flatMap(Database.Service, (database) =>
    database.transaction((transaction) => RenSettings.apply(transaction, defaults)),
  )

const globalAgents = Effect.flatMap(Database.Service, (database) =>
  database.db
    .select({
      id: Database.Schema.agent.id,
      name: Database.Schema.agent.name,
      description: Database.Schema.agent.description,
      archived: Database.Schema.agent.archived_at,
    })
    .from(Database.Schema.agent)
    .where(isNull(Database.Schema.agent.organization_id))
    .orderBy(asc(Database.Schema.agent.name)),
)

describe("RenSettings.apply", () => {
  it.live("a rerun updates Ren's agents in place and archives the ones it no longer lists", () =>
    Effect.gen(function* () {
      yield* apply({
        settings: settings("House rules."),
        agents: [
          { name: "ren", description: "Ren", isSubagent: false, settings: settings("You are Ren.") },
          { name: "explore", description: "Explores", isSubagent: true, settings: settings("You search.") },
        ],
      })
      const first = yield* globalAgents
      yield* apply({
        settings: settings("House rules, revised."),
        agents: [{ name: "ren", description: "Ren, revised", isSubagent: false, settings: settings("You are Ren.") }],
      })
      const second = yield* globalAgents
      expect(second.map((agent) => [agent.name, agent.description, Boolean(agent.archived)])).toEqual([
        ["explore", "Explores", true],
        ["ren", "Ren, revised", false],
      ])
      expect(second.map((agent) => agent.id)).toEqual(first.map((agent) => agent.id))
    }),
  )

  it.live("writes the system labels with their fixed IDs, once however often it runs", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      yield* apply({ settings: settings("House rules."), agents: [] })
      yield* apply({ settings: settings("House rules."), agents: [] })
      const labels = yield* database.db
        .select({ id: Database.Schema.label.id, name: Database.Schema.label.name })
        .from(Database.Schema.label)
        .where(isNull(Database.Schema.label.organization_id))
        .orderBy(asc(Database.Schema.label.id))
      expect(labels).toEqual(Label.system.map((label) => ({ id: label.id, name: label.name })))
    }),
  )
})

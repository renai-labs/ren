export * as RenSettings from "./ren.js"

import { Database } from "@ren/db/database"
import { Agent } from "@ren/schema/agent"
import { Label } from "@ren/schema/label"
import type { Settings } from "@ren/schema/settings"
import { and, eq, isNull, notInArray, sql } from "drizzle-orm"
import { Effect } from "effect"
import { SettingsRows } from "./rows.js"

export interface DefaultAgent {
  readonly name: string
  readonly description: string
  readonly isSubagent: boolean
  readonly settings: Settings.Info
}

export interface Defaults {
  readonly settings: Settings.Info
  readonly agents: ReadonlyArray<DefaultAgent>
}

export const apply = Effect.fnUntraced(function* (transaction: Database.Transaction, defaults: Defaults) {
  yield* SettingsRows.write(transaction, SettingsRows.ren, defaults.settings)
  yield* transaction
    .insert(Database.Schema.label)
    .values(Label.system.map((label) => ({ id: label.id, name: label.name })))
    .onConflictDoNothing({ target: Database.Schema.label.id })
  yield* transaction
    .update(Database.Schema.agent)
    .set({ archived_at: sql`now()`, updated_at: sql`now()` })
    .where(
      and(
        isNull(Database.Schema.agent.organization_id),
        isNull(Database.Schema.agent.archived_at),
        notInArray(
          Database.Schema.agent.name,
          defaults.agents.map((agent) => agent.name),
        ),
      ),
    )
  yield* Effect.forEach(defaults.agents, (agent) =>
    Effect.gen(function* () {
      const fields = { description: agent.description, is_subagent: agent.isSubagent }
      const updated = yield* transaction
        .update(Database.Schema.agent)
        .set({ ...fields, updated_at: sql`now()` })
        .where(
          and(
            isNull(Database.Schema.agent.organization_id),
            isNull(Database.Schema.agent.archived_at),
            eq(Database.Schema.agent.name, agent.name),
          ),
        )
        .returning({ id: Database.Schema.agent.id })
      const id = updated.at(0)?.id ?? Agent.ID.create()
      if (updated.length === 0)
        yield* transaction.insert(Database.Schema.agent).values({ id, name: agent.name, ...fields })
      yield* SettingsRows.write(transaction, { agent_id: id }, agent.settings)
    }),
  )
})

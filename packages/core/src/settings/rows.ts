export * as SettingsRows from "./rows.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Settings } from "@ren/schema/settings"
import type { Space } from "@ren/schema/space"
import { sql } from "drizzle-orm"
import { DateTime, Effect, Schema } from "effect"
import { Primitive } from "../primitive.js"

interface Ren {
  readonly organization_id?: never
  readonly space_id?: never
  readonly agent_id?: never
}

export type Owner =
  | Ren
  | { readonly organization_id: Auth.OrganizationID }
  | { readonly space_id: Space.ID }
  | { readonly agent_id: Agent.ID }

export const ren: Owner = {}

export const decode = (row: typeof Database.Schema.settings.$inferSelect | null | undefined) =>
  Schema.decodeUnknownEffect(Settings.Info)(row?.settings ?? {}).pipe(
    Effect.orDie,
    Effect.map((settings) => ({ settings, updatedAt: row ? DateTime.fromDateUnsafe(row.updated_at) : null })),
  )

export const write = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  owner: Owner,
  settings: Settings.Info,
) {
  const duplicate = Settings.duplicateAlias(settings)
  if (duplicate) return yield* new Primitive.Conflict({ message: `Two references use the alias ${duplicate}.` })
  const encoded = yield* Schema.encodeEffect(Settings.Info)(settings).pipe(Effect.orDie)
  yield* transaction
    .insert(Database.Schema.settings)
    .values({ ...owner, settings: encoded })
    .onConflictDoUpdate({
      target: Database.Schema.settings.owner_id,
      set: { settings: encoded, updated_at: sql`now()` },
    })
})

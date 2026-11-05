export * as SettingsRows from "./rows.js"

import { Database } from "@ren/db/database"
import type { Agent } from "@ren/schema/agent"
import type { Auth } from "@ren/schema/auth"
import { Settings } from "@ren/schema/settings"
import type { Space } from "@ren/schema/space"
import { inArray, sql } from "drizzle-orm"
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
  if (settings.timezone && ("space_id" in owner || "agent_id" in owner))
    return yield* new Primitive.Invalid({ message: "Timezone is an organization setting.", field: "timezone" })
  const encoded = yield* Schema.encodeEffect(Settings.Info)(settings).pipe(Effect.orDie)
  yield* transaction
    .insert(Database.Schema.settings)
    .values({ ...owner, settings: encoded })
    .onConflictDoUpdate({
      target: Database.Schema.settings.owner_id,
      set: { settings: encoded, updated_at: sql`now()` },
    })
})

export const timezone = Effect.fnUntraced(function* (
  transaction: Pick<Database.Transaction, "select">,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({
      ownerId: Database.Schema.settings.owner_id,
      timezone: sql<string | null>`${Database.Schema.settings.settings}->>'timezone'`,
    })
    .from(Database.Schema.settings)
    .where(inArray(Database.Schema.settings.owner_id, [organizationId, Database.Schema.renOwner]))
  const zoneOf = (ownerId: string) => rows.find((row) => row.ownerId === ownerId)?.timezone
  return zoneOf(organizationId) ?? zoneOf(Database.Schema.renOwner) ?? Settings.defaultTimezone
})

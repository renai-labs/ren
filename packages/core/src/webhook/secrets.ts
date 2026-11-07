export * as WebhookSecrets from "./secrets.js"

import type { Database } from "@ren/db/database"
import type { Envelope } from "@ren/schema/envelope"

export const contextOf = (
  row: Pick<typeof Database.Schema.webhook.$inferSelect, "id" | "organization_id">,
  column: "token" | "signing_secret",
): Envelope.Context => ({ organizationId: row.organization_id, kind: "webhook", id: `${row.id}:${column}` })

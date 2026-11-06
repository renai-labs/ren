export * as WebhookSecrets from "./secrets.js"

import type { Database } from "@ren/db/database"
import type { Envelope } from "@ren/schema/envelope"

// oxlint-disable-next-line ren/no-comments -- W16: each sealed column has its own context, so a token cannot be read as the signing secret.
export const contextOf = (
  row: Pick<typeof Database.Schema.webhook.$inferSelect, "id" | "organization_id">,
  column: "token" | "signing_secret",
): Envelope.Context => ({ organizationId: row.organization_id, kind: "webhook", id: `${row.id}:${column}` })

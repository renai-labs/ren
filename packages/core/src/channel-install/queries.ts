export * as ChannelInstallQueries from "./queries.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Channel } from "@ren/schema/channel"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, isNull, sql } from "drizzle-orm"
import { Effect, Option } from "effect"

const install = Database.Schema.channel_install
const mapping = Database.Schema.channel_mapping
const space = Database.Schema.space

export const defaultSpace = (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  defaultSpaceId: Space.ID | null,
) =>
  transaction
    .select({ spaceId: space.id })
    .from(space)
    .where(and(eq(space.organization_id, organizationId), isNull(space.archived_at)))
    .orderBy(sql`case when ${space.id} = ${defaultSpaceId} then 0 else 1 end`, asc(space.created_at), asc(space.id))
    .limit(1)
    .pipe(Effect.map((rows) => Option.fromNullishOr(rows.at(0)?.spaceId)))

export const servers = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
  spaceId: Space.ID,
) {
  const slack = (yield* transaction
    .select({ id: install.id, defaultSpaceId: install.default_space_id })
    .from(install)
    .where(and(eq(install.organization_id, organizationId), eq(install.provider, "slack")))).at(0)
  if (!slack) return []
  const mapped = yield* transaction
    .select({ id: mapping.id })
    .from(mapping)
    .where(and(eq(mapping.install_id, slack.id), eq(mapping.space_id, spaceId)))
    .limit(1)
  const own = yield* transaction
    .select({ id: space.id })
    .from(space)
    .where(and(eq(space.id, spaceId), eq(space.kind, "private")))
  const reached =
    mapped.length > 0 ||
    own.length > 0 ||
    Option.getOrUndefined(yield* defaultSpace(transaction, organizationId, slack.defaultSpaceId)) === spaceId
  return reached ? (["slack"] satisfies ReadonlyArray<Channel.Provider>) : []
})

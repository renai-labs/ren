export * as InfraChannels from "./channels.js"

import type { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Agent } from "@ren/schema/agent"
import type { Channel } from "@ren/schema/channel"
import type { Space } from "@ren/schema/space"
import { Effect } from "effect"
import type { InfraPlan } from "./plan.js"

export interface Live {
  readonly mappings: ReadonlyArray<never>
}

export const load = (_transaction: Database.Transaction, _organizationId: Auth.OrganizationID) =>
  Effect.succeed<Live>({ mappings: [] })

export const make = Effect.succeed({
  diff: (context: InfraPlan.Context, _live: Live): InfraPlan.Planned => ({
    steps: [],
    removals: [],
    problems: context.spaces
      .filter((space) => Object.keys(space.declaration.channels).length > 0)
      .map((space) => ({ path: `spaces/${space.slug}/channels`, message: "Infra does not apply channels yet." })),
  }),
  pull: (
    _live: Live,
    _spaceId: Space.ID,
    _name: (id: Agent.ID) => string | undefined,
  ): Record<string, Channel.Declaration> => ({}),
  pullBindings: (_live: Live, _spaceId: Space.ID): Record<string, Channel.Target> => ({}),
})

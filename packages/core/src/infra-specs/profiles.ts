export * as InfraProfiles from "./profiles.js"

import type { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Space } from "@ren/schema/space"
import { Effect } from "effect"
import type { InfraPlan } from "./plan.js"

export interface Live {
  readonly listings: ReadonlyArray<never>
}

export const load = (_transaction: Database.Transaction, _organizationId: Auth.OrganizationID) =>
  Effect.succeed<Live>({ listings: [] })

export const make = Effect.succeed({
  diff: (context: InfraPlan.Context, _live: Live): InfraPlan.Planned => ({
    steps: [],
    removals: [],
    problems: context.spaces
      .filter((space) => Object.keys(space.bindings?.profiles ?? {}).length > 0)
      .map((space) => ({
        path: `deploy.yaml/spaces/${space.slug}/profiles`,
        message: "Infra does not apply profiles yet.",
      })),
  }),
  pull: (_live: Live, _spaceId: Space.ID): Record<string, ReadonlyArray<string>> => ({}),
})

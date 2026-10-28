export * as InfraSchedules from "./schedules.js"

import type { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Agent } from "@ren/schema/agent"
import type { Schedule } from "@ren/schema/schedule"
import type { Space } from "@ren/schema/space"
import { Effect } from "effect"
import type { InfraPlan } from "./plan.js"

export interface Live {
  readonly schedules: ReadonlyArray<never>
}

export const load = (_transaction: Database.Transaction, _organizationId: Auth.OrganizationID) =>
  Effect.succeed<Live>({ schedules: [] })

export const make = Effect.succeed({
  diff: (context: InfraPlan.Context, _live: Live): InfraPlan.Planned => ({
    steps: [],
    removals: [],
    problems: context.spaces
      .filter((space) => Object.keys(space.declaration.schedules).length > 0)
      .map((space) => ({ path: `spaces/${space.slug}/schedules`, message: "Infra does not apply schedules yet." })),
  }),
  pull: (
    _live: Live,
    _spaceId: Space.ID,
    _name: (id: Agent.ID) => string | undefined,
  ): Record<string, Schedule.Declaration> => ({}),
})

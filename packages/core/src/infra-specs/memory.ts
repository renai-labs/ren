export * as InfraMemory from "./memory.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Memory as MemorySchema } from "@ren/schema/memory"
import type { Space } from "@ren/schema/space"
import { eq, or } from "drizzle-orm"
import { Effect } from "effect"
import { Memory } from "../memory.js"
import { InfraPlan } from "./plan.js"

export interface Live {
  readonly organization: MemorySchema.Files
  readonly spaces: ReadonlyMap<Space.ID, MemorySchema.Files>
}

export const path = (space: string | undefined, file: string) => `${space ? `spaces/${space}/` : ""}memory/${file}`

const withRoot = (files: MemorySchema.Files = {}): MemorySchema.Files => ({ [Memory.root]: "", ...files })

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({ spaceId: Database.Schema.memory.space_id, files: Database.Schema.memory.files })
    .from(Database.Schema.memory)
    .leftJoin(Database.Schema.space, eq(Database.Schema.space.id, Database.Schema.memory.space_id))
    .where(
      or(
        eq(Database.Schema.memory.organization_id, organizationId),
        eq(Database.Schema.space.organization_id, organizationId),
      ),
    )
  return {
    organization: rows.find((row) => !row.spaceId)?.files ?? {},
    spaces: new Map(rows.flatMap((row) => (row.spaceId ? [[row.spaceId, row.files]] : []))),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const memory = yield* Memory.Service

  const diff = (context: InfraPlan.Context, live: Live, organization: MemorySchema.Files): InfraPlan.Planned => ({
    steps: [
      { space: undefined, files: organization, current: live.organization },
      ...context.spaces.map((space) => ({
        space,
        files: space.declaration.memory,
        current: (space.liveId ? live.spaces.get(space.liveId) : undefined) ?? {},
      })),
    ]
      .flatMap((owner) =>
        Object.entries(owner.files).flatMap(([file, content]) => {
          if (withRoot(owner.current)[file] === content) return []
          const exists = Object.hasOwn(owner.current, file)
          context.touch(owner.space?.liveId)
          return [
            InfraPlan.step(
              exists ? "update" : "create",
              "memory",
              path(owner.space?.slug, file),
              Effect.gen(function* () {
                yield* memory.write(context.actor, {
                  ...(owner.space && { spaceId: yield* context.spaceId(owner.space.slug) }),
                  path: file,
                  content,
                })
              }),
              exists ? { fields: ["content"] } : {},
            ),
          ]
        }),
      )
      .toSorted(InfraPlan.byPath),
    removals: [],
    problems: [],
  })

  const pull = (live: Live, spaceId?: Space.ID) => withRoot(spaceId ? live.spaces.get(spaceId) : live.organization)

  return { diff, pull }
})

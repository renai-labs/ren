export * as InfraSchedules from "./schedules.js"

import { Database } from "@ren/db/database"
import type { Auth } from "@ren/schema/auth"
import type { Agent } from "@ren/schema/agent"
import type { Schedule } from "@ren/schema/schedule"
import type { Space } from "@ren/schema/space"
import { and, asc, eq, isNull } from "drizzle-orm"
import { DateTime, Effect } from "effect"
import { Schedules } from "../schedules.js"
import { InfraPlan } from "./plan.js"

export interface LiveSchedule {
  readonly id: Schedule.ID
  readonly spaceId: Space.ID
  readonly slug: string
  readonly name: string
  readonly agentId: Agent.ID | null
  readonly cron: string
  readonly timeZone: string
  readonly until: string | null
  readonly message: string
  readonly enabled: boolean
}

export interface Live {
  readonly schedules: ReadonlyArray<LiveSchedule>
  readonly unmanaged: ReadonlyArray<{ readonly spaceId: Space.ID; readonly slug: string }>
}

const path = (space: string, slug: string) => `spaces/${space}/schedules/${slug}`

const normalize = (cron: string) => cron.trim().split(/\s+/u).join(" ")

const untilOf = (declaration: Schedule.Declaration) =>
  declaration.until ? DateTime.formatIso(declaration.until) : null

const key = (spaceId: Space.ID, slug: string) => `${spaceId}/${slug}`

const whenOf = (declaration: Schedule.Declaration) => ({
  cron: declaration.cron,
  timeZone: declaration.timeZone,
  ...(declaration.until && { until: declaration.until }),
})

export const load = Effect.fnUntraced(function* (
  transaction: Database.Transaction,
  organizationId: Auth.OrganizationID,
) {
  const rows = yield* transaction
    .select({ schedule: Database.Schema.schedule, agentOrganizationId: Database.Schema.agent.organization_id })
    .from(Database.Schema.schedule)
    .leftJoin(Database.Schema.agent, eq(Database.Schema.agent.id, Database.Schema.schedule.agent_id))
    .where(
      and(eq(Database.Schema.schedule.organization_id, organizationId), isNull(Database.Schema.schedule.archived_at)),
    )
    .orderBy(asc(Database.Schema.schedule.space_id), asc(Database.Schema.schedule.slug))
  const isManaged = (row: (typeof rows)[number]) =>
    Boolean(row.schedule.cron) && !row.schedule.run_at && !row.schedule.target_session_id
  return {
    schedules: rows.filter(isManaged).map((row) => ({
      id: row.schedule.id,
      spaceId: row.schedule.space_id,
      slug: row.schedule.slug,
      name: row.schedule.name,
      agentId: row.agentOrganizationId ? row.schedule.agent_id : null,
      cron: normalize(row.schedule.cron ?? ""),
      timeZone: row.schedule.time_zone ?? "UTC",
      until: row.schedule.until_at ? DateTime.formatIso(DateTime.fromDateUnsafe(row.schedule.until_at)) : null,
      message: row.schedule.message,
      enabled: !row.schedule.paused_reason,
    })),
    unmanaged: rows
      .filter((row) => !isManaged(row))
      .map((row) => ({ spaceId: row.schedule.space_id, slug: row.schedule.slug })),
  } satisfies Live
})

export const make = Effect.gen(function* () {
  const schedules = yield* Schedules.Service

  const diff = (context: InfraPlan.Context, live: Live): InfraPlan.Planned => {
    const inScope = live.schedules.filter((schedule) => context.shared.has(schedule.spaceId))
    const byKey = new Map(inScope.map((schedule) => [key(schedule.spaceId, schedule.slug), schedule]))
    const unmanaged = new Set(live.unmanaged.map((schedule) => key(schedule.spaceId, schedule.slug)))
    const subagents = new Set(
      context.spaces.flatMap((space) =>
        Object.entries(space.declaration.agents)
          .filter((entry) => entry[1].isSubagent)
          .map((entry) => entry[0]),
      ),
    )
    const declared = context.spaces.flatMap((space) =>
      Object.entries(space.declaration.schedules).map(([slug, schedule]) => ({
        space: space.slug,
        liveId: space.liveId,
        slug,
        schedule,
      })),
    )
    const problems = declared.flatMap((entry) => [
      ...(entry.liveId && unmanaged.has(key(entry.liveId, entry.slug))
        ? [
            {
              path: path(entry.space, entry.slug),
              message: `Schedule slug “${entry.slug}” is taken by a one-time or chat schedule in this space. Choose another slug, or archive that schedule in the app.`,
            },
          ]
        : []),
      ...(entry.schedule.agent && subagents.has(entry.schedule.agent)
        ? [
            {
              path: path(entry.space, entry.slug),
              message: `Agent “${entry.schedule.agent}” is a subagent, so it cannot run a schedule. Pick another agent.`,
            },
          ]
        : []),
    ])

    const writes = declared.flatMap((entry): Array<InfraPlan.Step> => {
      const target = path(entry.space, entry.slug)
      const declaration = entry.schedule
      const name = declaration.name ?? entry.slug
      const current = entry.liveId ? byKey.get(key(entry.liveId, entry.slug)) : undefined
      if (!current) {
        context.touch(entry.liveId)
        return [
          InfraPlan.step(
            "create",
            "schedule",
            target,
            Effect.gen(function* () {
              const created = yield* schedules.create(context.actor, {
                spaceId: yield* context.spaceId(entry.space),
                name,
                slug: entry.slug,
                message: declaration.message,
                when: whenOf(declaration),
                ...(declaration.agent && { agentId: yield* context.agentId(declaration.agent) }),
              })
              if (!declaration.enabled) yield* schedules.pause(context.actor, created.id, {})
            }),
          ),
        ]
      }
      const agent = current.agentId ? (context.agentName(current.agentId) ?? current.agentId) : undefined
      const fields = InfraPlan.changed({
        name: current.name !== name,
        agent: agent !== declaration.agent,
        when:
          current.cron !== normalize(declaration.cron) ||
          current.timeZone !== declaration.timeZone ||
          current.until !== untilOf(declaration),
        message: current.message !== declaration.message,
        enabled: current.enabled !== declaration.enabled,
      })
      if (fields.length === 0) return []
      context.touch(current.spaceId)
      return [
        InfraPlan.step(
          "update",
          "schedule",
          target,
          Effect.gen(function* () {
            if (fields.some((field) => field !== "enabled"))
              yield* schedules.update(context.actor, current.id, {
                ...(fields.includes("name") && { name }),
                ...(fields.includes("agent") && {
                  agentId: declaration.agent ? yield* context.agentId(declaration.agent) : null,
                }),
                ...(fields.includes("when") && { when: whenOf(declaration) }),
                ...(fields.includes("message") && { message: declaration.message }),
              })
            if (fields.includes("enabled"))
              yield* declaration.enabled
                ? schedules.resume(context.actor, current.id, {})
                : schedules.pause(context.actor, current.id, {})
          }),
          { fields },
        ),
      ]
    })

    const wanted = new Set(declared.flatMap((entry) => (entry.liveId ? [key(entry.liveId, entry.slug)] : [])))
    const archives = inScope
      .filter((schedule) => !wanted.has(key(schedule.spaceId, schedule.slug)))
      .map((schedule) => {
        context.touch(schedule.spaceId)
        return InfraPlan.step(
          "archive",
          "schedule",
          path(context.slugOf(schedule.spaceId) ?? schedule.spaceId, schedule.slug),
          schedules.archive(context.actor, schedule.id),
        )
      })

    return { steps: writes.toSorted(InfraPlan.byPath), removals: archives.toSorted(InfraPlan.byPath), problems }
  }

  const pull = (
    live: Live,
    spaceId: Space.ID,
    name: (id: Agent.ID) => string | undefined,
  ): Record<string, Schedule.Declaration> =>
    Object.fromEntries(
      live.schedules
        .filter((schedule) => schedule.spaceId === spaceId)
        .map((schedule) => {
          const agent = schedule.agentId ? name(schedule.agentId) : undefined
          return [
            schedule.slug,
            {
              ...(schedule.name !== schedule.slug && { name: schedule.name }),
              ...(agent && { agent }),
              cron: schedule.cron,
              timeZone: schedule.timeZone,
              message: schedule.message,
              ...(schedule.until && { until: DateTime.makeUnsafe(schedule.until) }),
              enabled: schedule.enabled,
            },
          ]
        }),
    )

  return { diff, pull }
})

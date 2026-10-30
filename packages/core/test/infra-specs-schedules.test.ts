import { describe, expect } from "bun:test"
import { Schedule } from "@ren/schema/schedule"
import type { Space } from "@ren/schema/space"
import { DateTime, Effect, Schema } from "effect"
import type { Actor } from "../src/actor.js"
import { Agent } from "../src/agent.js"
import { ChannelProvider } from "../src/channel-provider.js"
import { InfraSpecs } from "../src/infra-specs.js"
import { Schedules } from "../src/schedules.js"
import { testEffect } from "./lib/effect.js"
import { InfraFixture } from "./lib/infra.js"

const it = testEffect(InfraFixture.layer(ChannelProvider.layer(Effect.succeed([]))))

const decodeCreate = Schema.decodeUnknownSync(Schedule.CreateInput)

const daily = (more: Record<string, unknown> = {}) => ({
  cron: "0 9 * * *",
  timeZone: "Europe/Berlin",
  message: "Post the report.",
  ...more,
})

const listed = Effect.fnUntraced(function* (actor: Actor.Info, spaceId: Space.ID) {
  const schedules = yield* Schedules.Service
  const page = yield* schedules.list(actor, { spaceId, page: 1, pageSize: 50 })
  return new Map(page.items.map((item) => [item.slug, item]))
})

describe("InfraSpecs schedules", () => {
  it.live("apply creates, updates, pauses and archives the recurring schedules of a space", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const agents = yield* Agent.Service
      const o = yield* InfraFixture.org
      const input = (spaces: Record<string, unknown>) => ({ bindings: o.bindings, spec: InfraFixture.spec(spaces) })
      const first = input({
        home: {
          name: "Home",
          agents: { reporter: {} },
          schedules: {
            report: daily({ name: "report", agent: "reporter" }),
            digest: daily({ name: "Digest", cron: "0  8 * * 1" }),
          },
        },
      })

      const created = yield* infra.plan(o.admin, first)

      expect(created).toMatchObject({
        changes: [
          InfraFixture.change("create", "agent", "spaces/home/agents/reporter"),
          InfraFixture.change("create", "schedule", "spaces/home/schedules/digest"),
          InfraFixture.change("create", "schedule", "spaces/home/schedules/report"),
        ],
        problems: [],
      })
      const applied = yield* infra.apply(o.admin, { ...first, digest: created.digest })
      expect(applied.lock).toEqual(InfraFixture.withoutMemory((yield* infra.pull(o.admin, {})).lock))
      const reporter = yield* agents.get(o.admin, "reporter")
      const after = yield* listed(o.admin, o.home.id)
      expect(after.get("report")).toMatchObject({
        name: "report",
        agentId: reporter.id,
        when: { cron: "0 9 * * *", timeZone: "Europe/Berlin" },
        status: "active",
      })
      expect(after.get("digest")).toMatchObject({ name: "Digest", agentId: null, when: { cron: "0 8 * * 1" } })
      expect(yield* infra.plan(o.admin, first)).toMatchObject({ changes: [], problems: [] })

      const second = input({
        home: {
          name: "Home",
          agents: { reporter: {} },
          schedules: { report: daily({ message: "Post the weekly report.", cron: "0 9 * * 1", enabled: false }) },
        },
      })
      const locked = yield* InfraFixture.current(o.admin, second)
      const updated = yield* infra.plan(o.admin, locked)

      expect(InfraFixture.withoutValues(updated.changes)).toEqual([
        InfraFixture.change("update", "schedule", "spaces/home/schedules/report", {
          fields: ["agent", "when", "message", "enabled"],
        }),
        InfraFixture.change("archive", "schedule", "spaces/home/schedules/digest"),
      ])
      yield* infra.apply(o.admin, { ...locked, digest: updated.digest })
      const paused = yield* listed(o.admin, o.home.id)
      expect([...paused.keys()]).toEqual(["report"])
      expect(paused.get("report")).toMatchObject({
        agentId: null,
        message: "Post the weekly report.",
        when: { cron: "0 9 * * 1" },
        status: "paused",
        pausedReason: "user",
      })

      const third = input({
        home: { name: "Home", agents: { reporter: {} }, schedules: { report: daily({ agent: "reporter" }) } },
      })
      const relocked = yield* InfraFixture.current(o.admin, third)
      const resumed = yield* infra.plan(o.admin, relocked)

      expect(InfraFixture.withoutValues(resumed.changes)).toEqual([
        InfraFixture.change("update", "schedule", "spaces/home/schedules/report", {
          fields: ["agent", "when", "message", "enabled"],
        }),
      ])
      yield* infra.apply(o.admin, { ...relocked, digest: resumed.digest })
      expect((yield* listed(o.admin, o.home.id)).get("report")).toMatchObject({
        agentId: reporter.id,
        status: "active",
        pausedReason: null,
      })
    }),
  )

  it.live("pull writes the recurring schedules back, and leaves one-time schedules alone", () =>
    Effect.gen(function* () {
      const infra = yield* InfraSpecs.Service
      const schedules = yield* Schedules.Service
      const o = yield* InfraFixture.org
      const until = "2099-01-01T00:00:00.000Z"
      const spec = {
        bindings: o.bindings,
        spec: InfraFixture.spec({
          home: {
            name: "Home",
            agents: { reporter: {} },
            schedules: {
              report: daily({ name: "Daily report", agent: "reporter", until }),
              digest: daily({ enabled: false }),
            },
          },
        }),
      }
      yield* infra.apply(o.admin, { ...spec, digest: (yield* infra.plan(o.admin, spec)).digest })
      yield* schedules.create(
        o.admin,
        decodeCreate({
          spaceId: o.home.id,
          name: "Reminder",
          slug: "reminder",
          message: "Remind me.",
          when: { in: "1 hour" },
        }),
      )

      const pulled = yield* infra.pull(o.admin, {})

      expect(pulled.spec.spaces["home"]?.schedules).toEqual({
        digest: { ...daily(), enabled: false },
        report: {
          ...daily(),
          name: "Daily report",
          agent: "reporter",
          until: DateTime.makeUnsafe(until),
          enabled: true,
        },
      })
      expect(yield* infra.plan(o.admin, yield* InfraFixture.replan(pulled))).toMatchObject({
        changes: [],
        problems: [],
      })
      expect((yield* listed(o.admin, o.home.id)).get("reminder")).toMatchObject({ status: "active" })

      const taken = yield* infra.plan(
        o.admin,
        yield* InfraFixture.current(o.admin, {
          bindings: o.bindings,
          spec: InfraFixture.spec({ home: { name: "Home", schedules: { reminder: daily() } } }),
        }),
      )

      expect(taken.problems).toEqual([
        {
          path: "spaces/home/schedules/reminder",
          message:
            "Schedule slug “reminder” is taken by a one-time or chat schedule in this space. Choose another slug, or archive that schedule in the app.",
        },
      ])
      expect(taken.changes.filter((change) => change.kind === "schedule")).toEqual([
        InfraFixture.change("create", "schedule", "spaces/home/schedules/reminder"),
        InfraFixture.change("archive", "schedule", "spaces/home/schedules/digest"),
        InfraFixture.change("archive", "schedule", "spaces/home/schedules/report"),
      ])
    }),
  )
})

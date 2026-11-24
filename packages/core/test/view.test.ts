import { describe, expect } from "bun:test"
import type { Space } from "@ren/schema/space"
import { Effect } from "effect"
import type { Actor } from "../src/actor.js"
import { SpaceMember } from "../src/space/member.js"
import { View } from "../src/view.js"
import { TaskFixture } from "./lib/task-fixture.js"

const it = TaskFixture.harness().it

const system = View.system.map((view) => view.name)

const names = (actor: Actor.Info, spaceId?: Space.ID) =>
  Effect.flatMap(View.Service, (views) =>
    views
      .list(actor, { ...(spaceId && { spaceId }), page: 1, pageSize: 100 })
      .pipe(Effect.map((result) => result.items.map((view) => view.name))),
  )

describe("View", () => {
  it.live(
    "everyone sees the system views first; a person sees their own views and the shared views of pages they see",
    () =>
      Effect.gen(function* () {
        const views = yield* View.Service
        const members = yield* SpaceMember.Service
        const o = yield* TaskFixture.org
        const task = { type: "task", filters: {} } as const
        const mine = yield* views.create(o.ada, { ...task, name: "Mine", filters: { status: ["todo"] } })
        yield* views.create(o.ada, { ...task, name: "Team", shared: true })
        yield* views.create(o.ada, { ...task, spaceId: o.factory.id, name: "Factory mine" })
        yield* views.create(o.ada, { ...task, spaceId: o.factory.id, name: "Factory team", shared: true })
        expect(mine).toMatchObject({
          ownerId: o.ada.userId,
          spaceId: null,
          shared: false,
          isSystem: false,
          display: null,
        })
        expect(yield* names(o.ada)).toEqual([...system, "Mine", "Team"])
        const paged = yield* views.list(o.ada, { page: 2, pageSize: 4 })
        expect({ names: paged.items.map((each) => each.name), total: paged.total }).toEqual({
          names: [...system.slice(4), "Mine", "Team"],
          total: system.length + 2,
        })
        expect(yield* names(o.ada, o.factory.id)).toEqual([...system, "Factory mine", "Factory team"])
        expect(yield* names(o.admin)).toEqual([...system, "Team"])
        expect(yield* names(o.grace, o.factory.id)).toEqual(system)
        const membership = yield* members.create(o.ada, { spaceId: o.factory.id, userId: o.grace.userId })
        expect(yield* names(o.grace, o.factory.id)).toEqual([...system, "Factory team"])
        yield* members.archive(o.ada, membership.id)
        expect(yield* names(o.grace, o.factory.id)).toEqual(system)
      }),
  )

  it.live("the owner changes a view, admins change only shared ones, and nobody changes a system view", () =>
    Effect.gen(function* () {
      const views = yield* View.Service
      const o = yield* TaskFixture.org
      const display = {
        layout: "board",
        groupBy: "status",
        orderBy: "priority",
        direction: "asc",
        showEmpty: false,
        properties: ["priority"],
      } as const
      const personal = yield* views.create(o.ada, { type: "task", name: "Mine", filters: {}, display })
      const shared = yield* views.create(o.ada, { type: "task", name: "Team", filters: {}, shared: true })
      const tag = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.map(Effect.flip(effect), (error) => error._tag)
      expect(yield* views.update(o.ada, personal.id, { name: "Bugs", filters: { label: ["bug"] } })).toMatchObject({
        name: "Bugs",
        filters: { label: ["bug"] },
        display,
      })
      expect((yield* views.update(o.ada, personal.id, { display: null })).display).toBeNull()
      expect(yield* tag(views.update(o.grace, personal.id, { name: "Taken" }))).toBe("Primitive.NotFound")
      expect(yield* tag(views.archive(o.admin, personal.id))).toBe("Primitive.NotFound")
      expect(yield* tag(views.update(o.grace, shared.id, { name: "Taken" }))).toBe("Primitive.Forbidden")
      expect((yield* views.update(o.admin, shared.id, { shared: false })).shared).toBe(false)
      expect(yield* tag(views.archive(o.admin, shared.id))).toBe("Primitive.NotFound")
      const all = View.system.at(0)?.id
      if (!all) return yield* Effect.die(new Error("No system view"))
      expect(yield* tag(views.update(o.admin, all, { name: "Everything" }))).toBe("Primitive.Forbidden")
      expect(
        yield* tag(views.create(o.grace, { type: "task", spaceId: o.factory.id, name: "Sneak", filters: {} })),
      ).toBe("Primitive.Forbidden")
      expect((yield* views.archive(o.ada, personal.id)).archivedAt).not.toBeNull()
      expect(yield* names(o.ada)).toEqual([...system, "Team"])
    }),
  )
})

import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import type { Task as TaskSchema } from "@ren/schema/task"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { Task } from "../src/task.js"
import { TaskActivity } from "../src/task/activity.js"
import { Seed } from "./lib/seed.js"
import { TaskFixture } from "./lib/task-fixture.js"

const harness = TaskFixture.harness()

const it = harness.it

const page = TaskFixture.page

const org = TaskFixture.org

const sessionOf = (task: { readonly session: { readonly id: Session.ID } | null }) => {
  if (!task.session) return Effect.die(new Error("The task has no session"))
  return Effect.succeed(task.session.id)
}

const sessions = (taskId: TaskSchema.ID) =>
  Effect.flatMap(Database.Service, (database) =>
    database.db
      .select({ sessionId: Database.Schema.task_session.session_id, agentId: Database.Schema.task_session.agent_id })
      .from(Database.Schema.task_session)
      .where(eq(Database.Schema.task_session.task_id, taskId)),
  )

describe("Task start", () => {
  it.live("the factory scenarios hold: each agent works in its own session, and a person closes each review", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const spaces = yield* Space.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const build = yield* o.agent("build")
      const review = yield* o.agent("review")
      yield* spaces.update(o.ada, o.factory.id, { agentOrder: [plan, build, review] })
      const script = harness.stub.script()
      const called = (count: number) => Effect.promise(() => script.called(count))
      const created = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: `Add SSO ${script.marker}`,
        description: "Support Okta.",
      })
      expect(created).toMatchObject({ agentId: null, session: null, status: "todo", humanReview: false })

      const given = yield* tasks.assign(o.ada, created.id, { agentId: plan, start: "none" })
      expect(given).toMatchObject({ agentId: plan, session: null, status: "todo" })

      const started = yield* tasks.start(o.ada, created.id, { mode: "continue" })
      expect(started).toMatchObject({ agentId: plan, status: "in_progress" })
      const planSession = yield* sessionOf(started)
      const first = yield* called(1)
      expect(first.text).toContain(`<task_assignment task_id="${created.id}"`)
      expect(first.text).toContain(created.identifier)
      expect(first.text).toContain("Support Okta.")
      expect(first.text).toMatch(/1\. plan[\s\S]*2\. build[\s\S]*3\. review/u)

      const planner = TaskFixture.actingAs(o.ada, o.factory.id, plan, planSession)
      const asked = yield* tasks.review(planner, created.id, { humanReview: true, reason: "Plan approval" })
      expect(asked).toMatchObject({ humanReview: true, humanReviewReason: "Plan approval", status: "in_progress" })
      expect(
        (yield* Effect.flip(tasks.review(planner, created.id, { humanReview: false, decision: "approved" })))._tag,
      ).toBe("Primitive.Forbidden")

      const approved = yield* tasks.review(o.ada, created.id, { humanReview: false, decision: "approved" })
      expect(approved).toMatchObject({ humanReview: false, humanReviewReason: null, session: { id: planSession } })
      expect((yield* called(2)).text).toContain("approved")

      const built = yield* tasks.assign(planner, created.id, { agentId: build, note: "Build the plan." })
      const buildSession = yield* sessionOf(built)
      expect(buildSession).not.toBe(planSession)
      const handoff = yield* called(3)
      expect(handoff.text).toContain("Build the plan.")
      expect(handoff.text).toContain("Support Okta.")

      const builder = TaskFixture.actingAs(o.ada, o.factory.id, build, buildSession)
      const reviewed = yield* tasks.assign(builder, created.id, { agentId: review })
      const reviewer = TaskFixture.actingAs(o.ada, o.factory.id, review, yield* sessionOf(reviewed))
      yield* called(4)
      const back = yield* tasks.assign(reviewer, created.id, { agentId: build, note: "Fix the tests." })
      expect(back.session?.id).toBe(buildSession)
      expect((yield* called(5)).text).toContain("Fix the tests.")
      yield* tasks.assign(o.ada, created.id, { ownerId: o.ada.userId })
      yield* tasks.start(o.ada, created.id, { mode: "continue" })
      expect((yield* called(6)).text).toContain("Fix the tests.")

      const takenOver = yield* tasks.assign(o.ada, created.id, { agentId: null })
      expect(takenOver).toMatchObject({ agentId: null, ownerId: o.ada.userId, session: null, status: "in_progress" })

      const returned = yield* tasks.assign(o.ada, created.id, { agentId: build, start: "continue" })
      expect(returned.session?.id).toBe(buildSession)
      expect((yield* called(7)).text).not.toContain("Fix the tests.")

      yield* tasks.review(builder, created.id, { humanReview: true, reason: "Ready to merge" })
      expect(yield* tasks.update(o.ada, created.id, { status: "done" })).toMatchObject({
        status: "done",
        humanReview: false,
        agentId: build,
      })
      expect(new Set((yield* sessions(created.id)).map((row) => row.agentId))).toEqual(new Set([plan, build, review]))
    }),
  )

  it.live(
    "a start records the initiator, the agent, the session and the mode; the first moves todo on; the description stays",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const activity = yield* TaskActivity.Service
        const o = yield* org
        const plan = yield* o.agent("plan")
        const script = harness.stub.script()
        const created = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: `Plan ${script.marker}`,
          description: "Support Okta.",
        })
        const started = yield* tasks.assign(o.ada, created.id, { agentId: plan, note: "Write the plan." })
        const sessionId = yield* sessionOf(started)
        yield* Effect.promise(() => script.called())
        const trail = yield* activity.list(o.ada, { taskId: created.id, ...page })
        expect(TaskFixture.kinds(trail)).toEqual(["created", "assigned", "started", "status"])
        expect(trail.items.slice(1).map((item) => (item.type === "event" ? item.event : undefined))).toMatchObject([
          { data: { _tag: "assigned", fromAgentId: null, toAgentId: plan, note: "Write the plan." } },
          {
            data: { _tag: "started", agentId: plan, sessionId, mode: "continue" },
            actor: { userId: o.ada.userId, agentId: null, sessionId: null },
          },
          { data: { _tag: "status", from: "todo", to: "in_progress" } },
        ])
        expect((yield* tasks.get(o.ada, created.id)).description).toBe("Support Okta.")
      }),
  )

  it.live("an assign with the same agent and no start changes nothing and starts nothing", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Plan", agentId: plan })
      expect(yield* tasks.assign(o.ada, created.id, { agentId: plan })).toMatchObject({ session: null })
      expect(yield* tasks.assign(o.ada, created.id, { ownerId: o.ada.userId })).toMatchObject({ session: null })
      expect(TaskFixture.kinds(yield* activity.list(o.ada, { taskId: created.id, ...page }))).toEqual([
        "created",
        "assigned",
      ])
    }),
  )

  it.live("new always opens a session; continue opens one when the agent's last session is archived", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const script = harness.stub.script()
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: `Plan ${script.marker}` })
      const first = yield* sessionOf(yield* tasks.assign(o.ada, created.id, { agentId: plan }))
      yield* Effect.promise(() => script.called(1))
      const fresh = yield* sessionOf(yield* tasks.start(o.ada, created.id, { mode: "new" }))
      expect(fresh).not.toBe(first)
      yield* Effect.promise(() => script.called(2))
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent_session.id, fresh))
      const resumed = yield* sessionOf(yield* tasks.start(o.ada, created.id, { mode: "continue" }))
      expect(resumed).toBe(first)
      yield* Effect.promise(() => script.called(3))
      yield* database.db
        .update(Database.Schema.agent_session)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent_session.id, first))
      const opened = yield* sessionOf(yield* tasks.start(o.ada, created.id, { mode: "continue" }))
      expect([first, fresh]).not.toContain(opened)
      yield* Effect.promise(() => script.called(4))
    }),
  )

  it.live("a ren session has no agent, and the task still records ren as the agent", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const script = harness.stub.script()
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: `Ask ren ${script.marker}` })
      const sessionId = yield* sessionOf(yield* tasks.assign(o.ada, created.id, { agentId: o.ren }))
      yield* Effect.promise(() => script.called())
      expect(yield* sessions(created.id)).toEqual([{ sessionId, agentId: o.ren }])
      const rows = yield* database.db
        .select({ agentId: Database.Schema.agent_session.agent_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, sessionId))
      expect(rows).toEqual([{ agentId: null }])
    }),
  )

  it.live("a task an agent creates logs the agent's session, which a later continue of that agent resumes", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const created = yield* tasks.create(build, {
        spaceId: o.factory.id,
        title: "Fix the flaky test",
        agentId: build.agent.agentId,
      })
      expect(created.session?.id).toBe(build.agent.sessionId)
      expect(yield* sessions(created.id)).toEqual([{ sessionId: build.agent.sessionId, agentId: build.agent.agentId }])
    }),
  )

  it.live("a start needs an actionable task with a live agent", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const unassigned = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Nobody" })
      const done = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done", agentId: plan, status: "done" })
      const archived = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Archived agent", agentId: plan })
      yield* database.db
        .update(Database.Schema.agent)
        .set({ archived_at: new Date() })
        .where(eq(Database.Schema.agent.id, plan))
      for (const task of [unassigned, done, archived]) {
        expect((yield* Effect.flip(tasks.start(o.ada, task.id, { mode: "new" })))._tag).toBe("Primitive.Conflict")
      }
      expect((yield* tasks.get(o.ada, archived.id)).agentId).toBe(plan)
      expect(yield* sessions(archived.id)).toEqual([])
    }),
  )
})

describe("Task assign", () => {
  it.live("the agent must be usable and the owner a member, and removing the agent turns review off", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const engAgent = yield* o.agent("eng-build", o.eng.id)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Plan", agentId: plan })
      expect((yield* Effect.flip(tasks.assign(o.ada, created.id, { agentId: engAgent })))._tag).toBe(
        "Primitive.Invalid",
      )
      expect((yield* Effect.flip(tasks.assign(o.ada, created.id, { ownerId: o.grace.userId })))._tag).toBe(
        "Primitive.Invalid",
      )
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
      expect(yield* tasks.assign(o.ada, created.id, { agentId: null })).toMatchObject({
        agentId: null,
        humanReview: false,
        humanReviewReason: null,
      })
    }),
  )

  it.live("a hand-off says whether the agent started, without failing the assign when the start fails", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const script = harness.stub.script()
      const open = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: `Plan ${script.marker}` })
      expect((yield* tasks.handOff(o.ada, open.id, { agentId: plan })).start).toBe("started")
      yield* Effect.promise(() => script.called())
      expect((yield* tasks.handOff(o.ada, open.id, { ownerId: o.ada.userId })).start).toBe("none")
      const done = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done", status: "done" })
      const failed = yield* tasks.handOff(o.ada, done.id, { agentId: plan })
      expect(failed).toMatchObject({ start: "failed", task: { agentId: plan, session: null } })
    }),
  )

  it.live("a member of both spaces moves a task; an owner outside the new space is cleared; an agent cannot move", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const members = yield* SpaceMember.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const carol = yield* Seed.actor(o.organizationId, "member")
      yield* members.create(o.admin, { spaceId: o.factory.id, userId: carol.userId })
      yield* members.create(o.admin, { spaceId: o.eng.id, userId: o.ada.userId })
      const plan = yield* o.agent("plan")
      const engAgent = yield* o.agent("eng-build", o.eng.id)
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const created = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: "Move me",
        agentId: plan,
        ownerId: carol.userId,
      })
      expect((yield* Effect.flip(tasks.assign(build, created.id, { agentId: engAgent, spaceId: o.eng.id })))._tag).toBe(
        "Primitive.NotFound",
      )
      expect((yield* Effect.flip(tasks.assign(o.ada, created.id, { ownerId: null, spaceId: o.eng.id })))._tag).toBe(
        "Primitive.Invalid",
      )
      const moved = yield* tasks.assign(o.ada, created.id, { agentId: engAgent, spaceId: o.eng.id, start: "none" })
      expect(moved).toMatchObject({ spaceId: o.eng.id, agentId: engAgent, ownerId: null })
      expect((yield* activity.list(o.ada, { taskId: created.id, ...page })).items.at(-1)).toMatchObject({
        event: {
          data: {
            _tag: "assigned",
            fromSpaceId: o.factory.id,
            toSpaceId: o.eng.id,
            fromOwnerId: carol.userId,
            toOwnerId: null,
          },
        },
      })
      expect((yield* Effect.flip(tasks.get(carol, created.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live(
    "a parent moves with its subtasks, which lose an agent or owner the new space lacks; a subtask cannot move alone",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const members = yield* SpaceMember.Service
        const activity = yield* TaskActivity.Service
        const o = yield* org
        const carol = yield* Seed.actor(o.organizationId, "member")
        yield* members.create(o.admin, { spaceId: o.factory.id, userId: carol.userId })
        yield* members.create(o.admin, { spaceId: o.eng.id, userId: o.ada.userId })
        const plan = yield* o.agent("plan")
        const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
        const kept = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: "Labels",
          parentId: parent.id,
          agentId: o.ren,
          ownerId: o.ada.userId,
        })
        const cleared = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: "Review",
          parentId: parent.id,
          agentId: plan,
          ownerId: carol.userId,
        })
        yield* tasks.review(o.ada, cleared.id, { humanReview: true, reason: "Check it" })
        expect((yield* Effect.flip(tasks.assign(o.ada, kept.id, { ownerId: null, spaceId: o.eng.id })))._tag).toBe(
          "Primitive.Invalid",
        )
        yield* tasks.assign(o.ada, parent.id, { spaceId: o.eng.id, ownerId: null })
        expect(yield* tasks.get(o.ada, kept.id)).toMatchObject({
          spaceId: o.eng.id,
          agentId: o.ren,
          ownerId: o.ada.userId,
        })
        expect(yield* tasks.get(o.ada, cleared.id)).toMatchObject({
          spaceId: o.eng.id,
          agentId: null,
          ownerId: null,
          humanReview: false,
        })
        expect((yield* activity.list(o.ada, { taskId: cleared.id, ...page })).items.at(-1)).toMatchObject({
          event: {
            data: {
              _tag: "assigned",
              fromAgentId: plan,
              toAgentId: null,
              fromOwnerId: carol.userId,
              toOwnerId: null,
              fromSpaceId: o.factory.id,
              toSpaceId: o.eng.id,
            },
          },
        })
        expect(TaskFixture.kinds(yield* activity.list(o.ada, { taskId: kept.id, ...page })).at(-1)).toBe("assigned")
      }),
  )
})

describe("Task review", () => {
  it.live("a decision needs an open review, a closed task takes none, and a person can leave the agent idle", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const done = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done", status: "done" })
      expect((yield* Effect.flip(tasks.review(o.ada, done.id, { humanReview: true, reason: "Look again" })))._tag).toBe(
        "Primitive.Conflict",
      )
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Plan", agentId: plan })
      expect(
        (yield* Effect.flip(tasks.review(o.ada, created.id, { humanReview: false, decision: "approved" })))._tag,
      ).toBe("Primitive.Conflict")
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
      const closed = yield* tasks.review(o.ada, created.id, {
        humanReview: false,
        decision: "changes_requested",
        comment: "Cover SCIM.",
        start: "none",
      })
      expect(closed).toMatchObject({ humanReview: false, session: null })
      const trail = yield* activity.list(o.ada, { taskId: created.id, ...page })
      expect(TaskFixture.kinds(trail)).toEqual(["created", "review_requested", "reviewed"])
      expect(trail.items.at(-1)).toMatchObject({
        event: { data: { _tag: "reviewed", decision: "changes_requested", comment: "Cover SCIM." } },
      })
    }),
  )

  it.live("a decision continues the agent with the comment and says when the description changed", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const plan = yield* o.agent("plan")
      const script = harness.stub.script()
      const created = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: `Plan ${script.marker}`,
        agentId: plan,
      })
      yield* tasks.review(o.ada, created.id, { humanReview: true, reason: "Check the plan" })
      yield* tasks.update(o.ada, created.id, { description: "Support Okta and SCIM." })
      const closed = yield* tasks.review(o.ada, created.id, {
        humanReview: false,
        decision: "changes_requested",
        comment: "Cover SCIM.",
      })
      expect(closed.session).not.toBeNull()
      const call = yield* Effect.promise(() => script.called())
      expect(call.text).toContain("changes_requested")
      expect(call.text).toContain("Cover SCIM.")
      expect(call.text).toContain("The description changed after the review was requested.")
      expect(call.text).toContain("Support Okta and SCIM.")
    }),
  )
})

import { describe, expect, setDefaultTimeout } from "bun:test"
import { Database } from "@ren/db/database"
import type { Session } from "@ren/schema/session"
import { eq } from "drizzle-orm"
import { Effect } from "effect"
import { Space } from "../src/space.js"
import { Task } from "../src/task.js"
import { TaskActivity } from "../src/task/activity.js"
import { TaskFixture } from "./lib/task-fixture.js"

setDefaultTimeout(60_000)

const harness = TaskFixture.harness()

const it = harness.it

const page = TaskFixture.page

const org = TaskFixture.org

const sessionOf = (task: { readonly session: { readonly id: Session.ID } | null }) => {
  if (!task.session) return Effect.die(new Error("The task has no session"))
  return Effect.succeed(task.session.id)
}

describe("Task start", () => {
  it.live(
    "the factory scenarios hold: each agent works in its own session, and a review closes as its sender decides (AC10)",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const spaces = yield* Space.Service
        const o = yield* org
        const plan = yield* o.agent("plan")
        const build = yield* o.agent("build")
        const review = yield* o.agent("review")
        yield* spaces.update(o.ada, o.factory.id, {
          factory: { maxHandoffs: 20, agents: [{ agentId: plan }, { agentId: build }, { agentId: review }] },
        })
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
        const approved = yield* tasks.review(planner, created.id, { humanReview: false, decision: "approved" })
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
        expect(new Set((yield* TaskFixture.sessions(created.id)).map((row) => row.agentId))).toEqual(
          new Set([plan, build, review]),
        )
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
      expect(yield* TaskFixture.sessions(created.id)).toEqual([{ sessionId, agentId: o.ren }])
      const rows = yield* database.db
        .select({ agentId: Database.Schema.agent_session.agent_id })
        .from(Database.Schema.agent_session)
        .where(eq(Database.Schema.agent_session.id, sessionId))
      expect(rows).toEqual([{ agentId: null }])
    }),
  )
})

describe("Task factory", () => {
  it.live(
    "a governed agent's start message lists its handoffs and limits, and an agent at its max runs cannot start",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const spaces = yield* Space.Service
        const o = yield* org
        const build = yield* o.agent("build")
        const review = yield* o.agent("review")
        yield* spaces.update(o.ada, o.factory.id, {
          factory: {
            maxHandoffs: 20,
            agents: [
              { agentId: build, to: [{ agentId: review, max: 2 }] },
              { agentId: review, maxRuns: 1, to: [{ agentId: build }] },
            ],
          },
        })
        const script = harness.stub.script()
        const created = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: `Ship ${script.marker}`,
          agentId: build,
        })
        const builder = TaskFixture.actingAs(
          o.ada,
          o.factory.id,
          build,
          yield* sessionOf(yield* tasks.start(o.ada, created.id, { mode: "new" })),
        )
        const first = yield* Effect.promise(() => script.called(1))
        expect(first.text).toContain(
          "Hand off with task_assign to one of:\n- review (used 0 of 2; then the task goes to human review)",
        )
        expect(first.text).toContain("Handoffs: 0 of 20.")
        const reviewer = TaskFixture.actingAs(
          o.ada,
          o.factory.id,
          review,
          yield* sessionOf(yield* tasks.assign(builder, created.id, { agentId: review })),
        )
        expect((yield* Effect.promise(() => script.called(2))).text).toContain(
          "Run 1 of 1 for review. Handoffs: 1 of 20.",
        )
        expect((yield* Effect.flip(tasks.start(reviewer, created.id, { mode: "continue" })))._tag).toBe(
          "Primitive.Conflict",
        )
      }),
  )
})

describe("Task assign", () => {
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
})

describe("Task review", () => {
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

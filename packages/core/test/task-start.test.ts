import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import { eq } from "drizzle-orm"
import type { Agent } from "@ren/schema/agent"
import type { Task as TaskSchema } from "@ren/schema/task"
import { Effect } from "effect"
import { Space } from "../src/space.js"
import { SpaceMember } from "../src/space/member.js"
import { Task } from "../src/task.js"
import { TaskActivity } from "../src/task/activity.js"
import { TaskTrail } from "../src/task/trail.js"
import { Seed } from "./lib/seed.js"
import { TaskFixture } from "./lib/task-fixture.js"

const harness = TaskFixture.harness()

const it = harness.it

const page = TaskFixture.page

const org = TaskFixture.org

describe("Task start", () => {
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
      expect(yield* TaskFixture.sessions(created.id)).toEqual([
        { sessionId: build.agent.sessionId, agentId: build.agent.agentId },
      ])
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
      expect(yield* TaskFixture.sessions(archived.id)).toEqual([])
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

  it.live(
    "a member of both spaces, or an agent acting for one (AC17), moves a task; an owner outside the new space is cleared",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const members = yield* SpaceMember.Service
        const activity = yield* TaskActivity.Service
        const o = yield* org
        const carol = yield* Seed.actor(o.organizationId, "member")
        yield* members.create(o.ada, { spaceId: o.factory.id, userId: carol.userId })
        yield* members.create(o.grace, { spaceId: o.eng.id, userId: o.ada.userId })
        const plan = yield* o.agent("plan")
        const engAgent = yield* o.agent("eng-build", o.eng.id)
        const build = yield* o.agentIn(o.ada, o.factory.id)
        const created = yield* tasks.create(o.ada, {
          spaceId: o.factory.id,
          title: "Move me",
          agentId: plan,
          ownerId: carol.userId,
        })
        expect((yield* Effect.flip(tasks.assign(o.ada, created.id, { ownerId: null, spaceId: o.eng.id })))._tag).toBe(
          "Primitive.Invalid",
        )
        const moved = yield* tasks.assign(build, created.id, { agentId: engAgent, spaceId: o.eng.id, start: "none" })
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
        yield* members.create(o.ada, { spaceId: o.factory.id, userId: carol.userId })
        yield* members.create(o.grace, { spaceId: o.eng.id, userId: o.ada.userId })
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
})

describe("Task factory", () => {
  const factory = Effect.gen(function* () {
    const spaces = yield* Space.Service
    const o = yield* org
    const session = (agentId: Agent.ID) =>
      Seed.session({ organizationId: o.organizationId, spaceId: o.factory.id, createdBy: o.ada.userId }).pipe(
        Effect.map((sessionId) => TaskFixture.actingAs(o.ada, o.factory.id, agentId, sessionId)),
      )
    const plan = yield* o.agent("plan")
    const build = yield* o.agent("build")
    const review = yield* o.agent("review")
    const qa = yield* o.agent("qa")
    yield* spaces.update(o.ada, o.factory.id, {
      factory: {
        maxHandoffs: 20,
        agents: [
          { agentId: plan },
          { agentId: build, to: [{ agentId: review }] },
          { agentId: review, to: [{ agentId: qa }, { agentId: build, max: 1 }] },
          { agentId: qa, to: [{ agentId: build, max: 1, else: review }] },
        ],
      },
    })
    return {
      o,
      plan,
      build,
      review,
      qa,
      builder: yield* session(build),
      reviewer: yield* session(review),
      tester: yield* session(qa),
    }
  })

  it.live(
    "a governed agent hands off only along its edges, an edge at its max asks a person, and the person's decision resets it",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const activity = yield* TaskActivity.Service
        const f = yield* factory
        const created = yield* tasks.create(f.o.ada, { spaceId: f.o.factory.id, title: "Ship", agentId: f.build })
        const handOff = (actor: typeof f.builder, agentId: Agent.ID) =>
          tasks.assign(actor, created.id, { agentId, start: "none" })
        const refused = yield* Effect.flip(handOff(f.builder, f.plan))
        expect(refused).toMatchObject({ _tag: "Primitive.Invalid", message: "build can hand off only to review." })
        expect(yield* handOff(f.builder, f.review)).toMatchObject({ agentId: f.review })
        expect(yield* handOff(f.builder, f.review)).toMatchObject({ agentId: f.review })
        expect((yield* Effect.flip(handOff(f.builder, f.qa)))._tag).toBe("Primitive.Conflict")
        expect(yield* handOff(f.reviewer, f.build)).toMatchObject({ agentId: f.build })
        yield* handOff(f.builder, f.review)
        expect(yield* handOff(f.reviewer, f.build)).toMatchObject({
          agentId: f.review,
          humanReview: true,
          humanReviewReason: "review → build used 1 of 1.",
        })
        expect((yield* activity.list(f.o.ada, { taskId: created.id, ...page })).items.at(-1)).toMatchObject({
          event: {
            data: { _tag: "review_requested", reason: "review → build used 1 of 1." },
            actor: { userId: null, agentId: null },
          },
        })
        yield* tasks.review(f.o.ada, created.id, { humanReview: false, decision: "approved", start: "none" })
        expect(yield* handOff(f.reviewer, f.build)).toMatchObject({ agentId: f.build, humanReview: false })
      }),
  )

  it.live("an edge at its max sends the task to its else agent, with a note that says why", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const f = yield* factory
      const created = yield* tasks.create(f.o.ada, { spaceId: f.o.factory.id, title: "Test", agentId: f.qa })
      yield* tasks.assign(f.tester, created.id, { agentId: f.build, start: "none" })
      yield* tasks.assign(f.builder, created.id, { agentId: f.review, start: "none" })
      yield* tasks.assign(f.reviewer, created.id, { agentId: f.qa, start: "none" })
      expect(yield* tasks.assign(f.tester, created.id, { agentId: f.build, start: "none" })).toMatchObject({
        agentId: f.review,
      })
      expect((yield* activity.list(f.o.ada, { taskId: created.id, ...page })).items.at(-1)).toMatchObject({
        event: {
          data: {
            _tag: "assigned",
            fromAgentId: f.qa,
            toAgentId: f.review,
            note: "review got the task instead of build: qa → build used 1 of 1.",
          },
        },
      })
    }),
  )

  it.live(
    "a governed agent's run that ends with no handoff asks a person; a handoff, an interruption, an earlier turn or an agent with no edges does not",
    () =>
      Effect.gen(function* () {
        const database = yield* Database.Service
        const tasks = yield* Task.Service
        const f = yield* factory
        const ran = Effect.fnUntraced(function* (
          actor: typeof f.builder,
          outcome: "succeeded" | "failed" | "interrupted",
          more: { readonly handOff?: Agent.ID; readonly idleAt?: number } = {},
        ) {
          const task = yield* tasks.create(f.o.ada, {
            spaceId: f.o.factory.id,
            title: "Ship",
            agentId: actor.agent.agentId,
          })
          const sessionId = yield* Seed.session({
            organizationId: f.o.organizationId,
            spaceId: f.o.factory.id,
            createdBy: f.o.ada.userId,
          })
          yield* database.db
            .insert(Database.Schema.task_session)
            .values({ task_id: task.id, session_id: sessionId, agent_id: actor.agent.agentId })
          yield* database.transaction((transaction) =>
            TaskTrail.record(transaction, { id: task.id, organizationId: f.o.organizationId }, f.o.ada, [
              { _tag: "started", agentId: actor.agent.agentId, sessionId, mode: "new" },
              { _tag: "status", from: "todo", to: "in_progress" },
            ]),
          )
          if (more.handOff) yield* tasks.assign(actor, task.id, { agentId: more.handOff, start: "none" })
          yield* database.db.insert(Database.Schema.opencode_session).values({
            session_id: sessionId,
            project_id: "prj_1",
            slug: "calm-river",
            directory: "/workspace",
            version: "2.0.27",
            cost: 0,
            tokens_input: 0,
            tokens_output: 0,
            tokens_reasoning: 0,
            tokens_cache_read: 0,
            tokens_cache_write: 0,
            time_created: 1,
            time_updated: 2,
            time_idle: more.idleAt ?? Date.now() + 60_000,
            idle_outcome: outcome,
          })
          yield* tasks.runEnded(sessionId)
          return yield* tasks.get(f.o.ada, task.id)
        })
        const review = (task: TaskSchema.Info) => ({ humanReview: task.humanReview, reason: task.humanReviewReason })
        expect(review(yield* ran(f.builder, "succeeded"))).toEqual({
          humanReview: true,
          reason: "build ended its run without a handoff.",
        })
        expect(review(yield* ran(f.builder, "failed"))).toEqual({
          humanReview: true,
          reason: "build stopped with an error.",
        })
        expect((yield* ran(f.builder, "succeeded", { handOff: f.review })).humanReview).toBe(false)
        expect((yield* ran(f.builder, "succeeded", { idleAt: Date.now() - 60_000 })).humanReview).toBe(false)
        expect((yield* ran(f.builder, "interrupted")).humanReview).toBe(false)
        const planner = TaskFixture.actingAs(f.o.ada, f.o.factory.id, f.plan, f.builder.agent.sessionId)
        expect((yield* ran(planner, "succeeded")).humanReview).toBe(false)
      }),
  )
})

import { describe, expect } from "bun:test"
import { Database } from "@ren/db/database"
import type { Task as TaskSchema } from "@ren/schema/task"
import { eq } from "drizzle-orm"
import { Deferred, Effect, Fiber } from "effect"
import { SqlClient } from "effect/sql"
import { Label } from "../src/label.js"
import { SpaceMember } from "../src/space/member.js"
import { Task } from "../src/task.js"
import { TaskActivity } from "../src/task/activity.js"
import { TaskComment } from "../src/task/comment.js"
import { Seed } from "./lib/seed.js"
import { TaskFixture } from "./lib/task-fixture.js"

const it = TaskFixture.harness().it

const page = TaskFixture.page

const org = TaskFixture.org

const kinds = TaskFixture.kinds

describe("Task", () => {
  it.live("a new task is todo, numbered from 1 in its organization, and named by the organization's slug", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const first = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      const second = yield* tasks.create(o.grace, { spaceId: o.eng.id, title: "Fix billing" })
      expect(first).toMatchObject({
        number: 1,
        identifier: `${o.prefix}-1`,
        title: "Add SSO",
        status: "todo",
        priority: null,
        humanReview: false,
        humanReviewReason: null,
        agentId: null,
        ownerId: null,
        session: null,
        labels: [],
        links: [],
        createdBy: { userId: o.ada.userId, agentId: null, sessionId: null },
        canUpdate: true,
      })
      expect(second.number).toBe(2)
      expect(yield* tasks.get(o.ada, `${o.prefix.toLowerCase()}-1`)).toEqual(first)
    }),
  )

  it.live("concurrent creates never share a number, and the prefix stays when the slug changes", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const created = yield* Effect.all(
        Array.from({ length: 8 }, (_, index) => tasks.create(o.ada, { spaceId: o.factory.id, title: `T${index}` })),
        { concurrency: "unbounded" },
      )
      expect(new Set(created.map((task) => task.number)).size).toBe(8)
      yield* database.db
        .update(Database.Schema.organization)
        .set({ slug: "renamed" })
        .where(eq(Database.Schema.organization.id, o.organizationId))
      expect((yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Later" })).identifier).toBe(`${o.prefix}-9`)
    }),
  )

  it.live("only members of the task's space see it; others, admins included (AC4), get NotFound", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      expect((yield* Effect.flip(tasks.get(o.grace, created.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(tasks.update(o.grace, created.id, { title: "Mine" })))._tag).toBe("Primitive.NotFound")
      expect((yield* tasks.list(o.grace, page)).items).toEqual([])
      expect((yield* Effect.flip(tasks.get(o.admin, created.id)))._tag).toBe("Primitive.NotFound")
      expect((yield* Effect.flip(tasks.create(o.grace, { spaceId: o.factory.id, title: "Sneak" })))._tag).toBe(
        "Primitive.NotFound",
      )
    }),
  )

  it.live("an agent reaches the tasks its sender reaches, in every space the sender is in (AC17)", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const members = yield* SpaceMember.Service
      const o = yield* org
      const hidden = yield* tasks.create(o.grace, { spaceId: o.eng.id, title: "Eng work" })
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const own = yield* tasks.create(build, { spaceId: o.factory.id, title: "Factory work" })
      expect(own.createdBy).toEqual({
        userId: o.ada.userId,
        agentId: build.agent.agentId,
        sessionId: build.agent.sessionId,
      })
      expect((yield* tasks.list(build, page)).items.map((task) => task.id)).toEqual([own.id])
      expect((yield* Effect.flip(tasks.get(build, hidden.id)))._tag).toBe("Primitive.NotFound")
      yield* members.create(o.grace, { spaceId: o.eng.id, userId: o.ada.userId })
      expect((yield* tasks.get(build, hidden.id)).id).toBe(hidden.id)
      expect((yield* tasks.create(build, { spaceId: o.eng.id, title: "Eng from the factory" })).spaceId).toBe(o.eng.id)
    }),
  )

  it.live("the default list has the actionable tasks, newest first; includeDone and a status widen or narrow it", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const first = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "First" })
      const second = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Second", status: "in_progress" })
      const done = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Done", status: "done" })
      const ids = (input: Partial<TaskSchema.ListInput>) =>
        tasks.list(o.ada, { ...page, ...input }).pipe(Effect.map((result) => result.items.map((task) => task.id)))
      expect(yield* ids({})).toEqual([second.id, first.id])
      expect(yield* ids({ includeDone: true })).toEqual([done.id, second.id, first.id])
      expect(yield* ids({ status: "done" })).toEqual([done.id])
    }),
  )

  it.live("an archived task leaves lists and get, and its trail stays", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      yield* tasks.archive(o.ada, created.id)
      expect((yield* tasks.list(o.ada, { ...page, includeDone: true })).items).toEqual([])
      expect((yield* Effect.flip(tasks.get(o.ada, created.id)))._tag).toBe("Primitive.NotFound")
      const trail = yield* database.db
        .select({ kind: Database.Schema.task_event.kind })
        .from(Database.Schema.task_event)
        .where(eq(Database.Schema.task_event.task_id, created.id))
      expect(trail.map((event) => event.kind)).toEqual(["created", "archived"])
    }),
  )

  it.live("a change writes one event for each kind of change, and a change that changes nothing writes none", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      const change = { title: "Add SAML SSO", priority: "high", status: "in_progress" } as const
      yield* tasks.update(o.ada, created.id, change)
      yield* tasks.update(o.ada, created.id, change)
      const trail = yield* activity.list(o.ada, { taskId: created.id, ...page })
      expect(kinds(trail)).toEqual(["created", "status", "field", "field"])
      expect(trail.items.at(2)).toMatchObject({
        event: { data: { _tag: "field", field: "title", from: "Add SSO", to: "Add SAML SSO" } },
      })
    }),
  )

  it.live("a person, or an agent acting for one (AC10), sets done or dismissed, and done turns human review off", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      expect((yield* tasks.update(build, created.id, { status: "dismissed" })).status).toBe("dismissed")
      yield* database.db
        .update(Database.Schema.task)
        .set({ human_review: true, human_review_reason: "Ready to merge" })
        .where(eq(Database.Schema.task.id, created.id))
      expect(yield* tasks.update(o.ada, created.id, { status: "done" })).toMatchObject({
        status: "done",
        humanReview: false,
        humanReviewReason: null,
      })
    }),
  )

  it.live("labels reuse a live label ignoring case, keep its spelling, and replace the whole set", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const labels = yield* Label.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      yield* labels.create(o.ada, { spaceId: o.factory.id, name: "Bug" })
      const created = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: "Add SSO",
        labels: ["bug", "Backend", "backend"],
      })
      expect(created.labels.map((label) => label.name)).toEqual(["Backend", "Bug"])
      const updated = yield* tasks.update(o.ada, created.id, { labels: ["ren-fix"] })
      expect(updated.labels).toMatchObject([{ name: "ren-fix", isSystem: true }])
      expect((yield* labels.list(o.ada, { page: 1, pageSize: 100 })).items.map((label) => label.name)).toEqual([
        "ren-fix",
        "ren-improve",
        "Backend",
        "Bug",
      ])
      expect((yield* tasks.list(o.ada, { ...page, label: "REN-FIX" })).items.map((task) => task.id)).toEqual([
        created.id,
      ])
      const trail = yield* activity.list(o.ada, { taskId: created.id, ...page })
      expect(kinds(trail)).toEqual(["created", "label", "label"])
      expect(trail.items.at(1)).toMatchObject({ event: { data: { _tag: "label", from: [], to: ["Backend", "Bug"] } } })
      expect(trail.items.at(-1)).toMatchObject({
        event: { data: { _tag: "label", from: ["Backend", "Bug"], to: ["ren-fix"] } },
      })
    }),
  )

  it.live("links match however a URL is written; adding keeps the others, removing works by URL or ID", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const pull = "https://github.com/renai-labs/ren/pull/12"
      const created = yield* tasks.create(o.ada, {
        spaceId: o.factory.id,
        title: "Add SSO",
        links: [pull, `${pull}/files`],
      })
      expect(created.links.map((link) => link.url)).toEqual([pull])
      const issue = "https://linear.app/renai/issue/REN-1442/tasks"
      const added = yield* tasks.update(o.ada, created.id, { addLinks: [issue, `${pull}/files`] })
      expect(added.links.map((link) => link.url)).toEqual([pull, issue])
      const linked = yield* tasks.list(o.ada, { ...page, linkedTo: "https://linear.app/RENAI/issue/ren-1442" })
      expect(linked.items.map((task) => task.id)).toEqual([created.id])
      const removed = yield* tasks.update(o.ada, created.id, {
        removeLinks: [
          `${pull}/files`,
          ...added.links.filter((link) => link.kind === "linear_issue").map((link) => link.id),
        ],
      })
      expect(removed.links).toEqual([])
      expect(kinds(yield* activity.list(o.ada, { taskId: created.id, ...page }))).toEqual([
        "created",
        "link",
        "link",
        "link",
      ])
    }),
  )

  it.live("a task has at most 32 links, counted after duplicates collapse", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const links = Array.from({ length: 32 }, (_, index) => `https://example.com/${index}`)
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Many", links })
      expect((yield* tasks.update(o.ada, created.id, { addLinks: links.slice(0, 1) })).links).toHaveLength(32)
      expect((yield* Effect.flip(tasks.update(o.ada, created.id, { addLinks: ["https://example.com/33"] })))._tag).toBe(
        "Primitive.Invalid",
      )
    }),
  )

  it.live(
    "the agent must be usable in the task's space, the global ren agent always is, and the owner is a member",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const o = yield* org
        const engAgent = yield* Seed.agent({ organizationId: o.organizationId, spaceId: o.eng.id }, "eng-build", {
          isSubagent: false,
        })
        expect(
          (yield* Effect.flip(tasks.create(o.ada, { spaceId: o.factory.id, title: "A", agentId: engAgent })))._tag,
        ).toBe("Primitive.Invalid")
        expect((yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "B", agentId: o.ren })).agentId).toBe(o.ren)
        expect(
          (yield* Effect.flip(tasks.create(o.ada, { spaceId: o.factory.id, title: "C", ownerId: o.grace.userId })))
            ._tag,
        ).toBe("Primitive.Invalid")
      }),
  )
})

describe("Subtasks", () => {
  it.live("two tasks made each other's parent at the same moment: one wins and the other is refused", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const sql = yield* SqlClient.SqlClient
      const o = yield* org
      const a = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "A" })
      const b = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "B" })
      const locked = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* Effect.forkChild(
        sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`select id from task where id = ${b.id} for update`
            yield* Deferred.succeed(locked, undefined)
            yield* Deferred.await(release)
          }),
        ),
      )
      yield* Deferred.await(locked)
      const writes = yield* Effect.forkChild(
        Effect.all(
          [
            Effect.result(tasks.update(o.ada, a.id, { parentId: b.id })),
            Effect.result(tasks.update(o.ada, b.id, { parentId: a.id })),
          ],
          { concurrency: "unbounded" },
        ),
      )
      yield* sql<{ readonly waiting: number }>`select count(*)::int as waiting from pg_stat_activity
        where datname = current_database() and wait_event_type in ('Lock', 'Advisory')`.pipe(
        Effect.repeat({ until: (rows) => (rows.at(0)?.waiting ?? 0) >= 2 || writes.pollUnsafe() !== undefined }),
        Effect.ensuring(Deferred.succeed(release, undefined)),
      )
      yield* Fiber.join(holder)
      const results = yield* Fiber.join(writes)
      expect(results.map((result) => (result._tag === "Success" ? "Success" : result.failure._tag)).toSorted()).toEqual(
        ["Primitive.Invalid", "Success"],
      )
    }),
  )

  it.live("a subtask names its parent, and the parent counts its live subtasks without the dismissed ones", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
      const labels = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Labels", parentId: parent.id })
      yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Review", parentId: parent.id, status: "done" })
      yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Drop", parentId: parent.id, status: "dismissed" })
      const archived = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Gone", parentId: parent.id })
      yield* tasks.archive(o.ada, archived.id)
      expect(labels).toMatchObject({
        parentId: parent.id,
        parent: { id: parent.id, identifier: parent.identifier, title: "Tasks" },
        subtasks: null,
      })
      expect(yield* tasks.get(o.ada, parent.id)).toMatchObject({
        parentId: null,
        parent: null,
        subtasks: { total: 2, done: 1 },
      })
    }),
  )

  it.live(
    "a parent is a task of the same space that is not a subtask, and a task with subtasks cannot become one",
    () =>
      Effect.gen(function* () {
        const tasks = yield* Task.Service
        const o = yield* org
        const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
        const child = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Labels", parentId: parent.id })
        const loose = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Review" })
        const members = yield* SpaceMember.Service
        yield* members.create(o.ada, { spaceId: o.factory.id, userId: o.grace.userId })
        const elsewhere = yield* tasks.create(o.grace, { spaceId: o.eng.id, title: "Eng" })
        const refusals = yield* Effect.all(
          [
            tasks.create(o.grace, { spaceId: o.eng.id, title: "Elsewhere", parentId: parent.id }),
            tasks.update(o.grace, loose.id, { parentId: elsewhere.id }),
            tasks.update(o.ada, loose.id, { parentId: loose.id }),
            tasks.update(o.ada, loose.id, { parentId: child.id }),
            tasks.update(o.ada, parent.id, { parentId: loose.id }),
          ].map((effect) => Effect.flip(effect)),
        )
        for (const error of refusals) expect(error).toMatchObject({ _tag: "Primitive.Invalid", field: "parentId" })
      }),
  )

  it.live("the parent filter lists a parent's subtasks oldest first, or only top-level tasks", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
      const first = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Labels", parentId: parent.id })
      const second = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Review", parentId: parent.id })
      const other = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Other" })
      const ids = (parentId: TaskSchema.ListInput["parentId"]) =>
        tasks.list(o.ada, { ...page, parentId }).pipe(Effect.map((result) => result.items.map((task) => task.id)))
      expect(yield* ids(parent.id)).toEqual([first.id, second.id])
      expect(yield* ids("none")).toEqual([other.id, parent.id])
      expect(yield* ids(undefined)).toEqual([other.id, second.id, first.id, parent.id])
    }),
  )

  it.live("an update sets or clears the parent and writes a parent event; the same parent changes nothing", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
      const loose = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Review" })
      expect((yield* tasks.update(o.ada, loose.id, { parentId: parent.id })).parentId).toBe(parent.id)
      expect((yield* tasks.update(o.ada, loose.id, { parentId: parent.id })).parentId).toBe(parent.id)
      expect((yield* tasks.update(o.ada, loose.id, { parentId: null })).parentId).toBeNull()
      const trail = yield* activity.list(o.ada, { taskId: loose.id, ...page })
      expect(trail.items.slice(1).map((item) => (item.type === "event" ? item.event.data : undefined))).toEqual([
        { _tag: "parent", from: null, to: parent.id },
        { _tag: "parent", from: parent.id, to: null },
      ])
    }),
  )

  it.live("a task that becomes a subtask while it gets a subtask never makes two levels", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const o = yield* org
      const top = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Top" })
      const middle = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Middle" })
      const results = yield* Effect.all(
        [
          tasks.update(o.ada, middle.id, { parentId: top.id }),
          tasks.create(o.ada, { spaceId: o.factory.id, title: "Bottom", parentId: middle.id }),
        ],
        { concurrency: "unbounded", mode: "result" },
      )
      expect(results.filter((result) => result._tag === "Success")).toHaveLength(1)
      expect(results.find((result) => result._tag === "Failure")).toMatchObject({
        failure: { _tag: "Primitive.Invalid", field: "parentId" },
      })
    }),
  )

  it.live("archiving a parent archives its subtasks, each with its own event", () =>
    Effect.gen(function* () {
      const database = yield* Database.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const parent = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Tasks" })
      const child = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Labels", parentId: parent.id })
      yield* tasks.archive(o.ada, parent.id)
      expect((yield* Effect.flip(tasks.get(o.ada, child.id)))._tag).toBe("Primitive.NotFound")
      const trail = yield* database.db
        .select({ kind: Database.Schema.task_event.kind })
        .from(Database.Schema.task_event)
        .where(eq(Database.Schema.task_event.task_id, child.id))
      expect(trail.map((event) => event.kind)).toEqual(["created", "archived"])
    }),
  )
})

describe("TaskComment", () => {
  it.live("only the author edits or archives a comment; an edit with the same text changes nothing", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const comments = yield* TaskComment.Service
      const members = yield* SpaceMember.Service
      const o = yield* org
      yield* members.create(o.ada, { spaceId: o.factory.id, userId: o.grace.userId })
      const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      const comment = yield* comments.create(o.ada, { taskId: task.id, body: "Looks good" })
      expect(comment).toMatchObject({ editedAt: null, canUpdate: true, author: { userId: o.ada.userId } })
      expect((yield* Effect.flip(comments.update(o.grace, comment.id, { body: "Mine now" })))._tag).toBe(
        "Primitive.Forbidden",
      )
      expect((yield* Effect.flip(comments.archive(o.grace, comment.id)))._tag).toBe("Primitive.Forbidden")
      expect((yield* comments.update(o.ada, comment.id, { body: "Looks good" })).editedAt).toBeNull()
      const edited = yield* comments.update(o.ada, comment.id, { body: "Looks great" })
      expect(edited).toMatchObject({ body: "Looks great" })
      expect(edited.editedAt).not.toBeNull()
    }),
  )

  it.live("an archived comment leaves the activity, and a second archive gets NotFound", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const comments = yield* TaskComment.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      const comment = yield* comments.create(o.ada, { taskId: task.id, body: "Looks good" })
      yield* comments.archive(o.ada, comment.id)
      expect(kinds(yield* activity.list(o.ada, { taskId: task.id, ...page }))).toEqual(["created"])
      expect((yield* Effect.flip(comments.archive(o.ada, comment.id)))._tag).toBe("Primitive.NotFound")
    }),
  )
})

describe("TaskActivity", () => {
  it.live("events and comments interleave oldest first, and new activity goes on the last page", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const comments = yield* TaskComment.Service
      const activity = yield* TaskActivity.Service
      const o = yield* org
      const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO" })
      yield* comments.create(o.ada, { taskId: task.id, body: "First" })
      yield* tasks.update(o.ada, task.id, { status: "in_progress" })
      const firstPage = yield* activity.list(o.ada, { taskId: task.id, page: 1, pageSize: 2 })
      yield* comments.create(o.ada, { taskId: task.id, body: "Second" })
      expect(yield* activity.list(o.ada, { taskId: task.id, page: 1, pageSize: 2 })).toEqual({
        ...firstPage,
        total: 4,
      })
      expect(kinds(firstPage)).toEqual(["created", "comment"])
      expect(kinds(yield* activity.list(o.ada, { taskId: task.id, page: 2, pageSize: 2 }))).toEqual([
        "status",
        "comment",
      ])
    }),
  )
})

describe("Label", () => {
  it.live(
    "an org label is unique in the org and a space label in its space, ignoring case; an archived label frees it",
    () =>
      Effect.gen(function* () {
        const labels = yield* Label.Service
        const o = yield* org
        const bug = yield* labels.create(o.admin, { name: "Bug", color: "#d45f5f" })
        const other = yield* labels.create(o.admin, { name: "Feature" })
        expect((yield* Effect.flip(labels.create(o.admin, { name: "BUG" })))._tag).toBe("Primitive.Conflict")
        expect((yield* Effect.flip(labels.update(o.admin, other.id, { name: "bug" })))._tag).toBe("Primitive.Conflict")
        expect((yield* labels.create(o.ada, { spaceId: o.factory.id, name: "bug" })).spaceId).toBe(o.factory.id)
        expect((yield* Effect.flip(labels.create(o.ada, { spaceId: o.factory.id, name: "BUG" })))._tag).toBe(
          "Primitive.Conflict",
        )
        yield* labels.archive(o.admin, bug.id)
        expect((yield* labels.create(o.admin, { name: "bug" })).name).toBe("bug")
      }),
  )

  it.live("only admins write org labels; a space label is written by and seen in its space only (AC8)", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const o = yield* org
      expect((yield* Effect.flip(labels.create(o.ada, { name: "Org" })))._tag).toBe("Primitive.Forbidden")
      const shared = yield* labels.create(o.admin, { name: "Org" })
      expect((yield* Effect.flip(labels.archive(o.ada, shared.id)))._tag).toBe("Primitive.Forbidden")
      const secret = yield* labels.create(o.ada, { spaceId: o.factory.id, name: "acme-acquisition" })
      expect((yield* Effect.flip(labels.create(o.grace, { spaceId: o.factory.id, name: "Sneak" })))._tag).toBe(
        "Primitive.Forbidden",
      )
      const names = (actor: typeof o.ada) =>
        labels.list(actor, page).pipe(Effect.map((result) => result.items.map((label) => label.name)))
      expect(yield* names(o.ada)).toContain(secret.name)
      expect(yield* names(o.grace)).not.toContain(secret.name)
      expect(yield* names(o.admin)).not.toContain(secret.name)
      expect((yield* Effect.flip(labels.archive(o.grace, secret.id)))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("an agent creates and changes the labels its sender can (AC10); a new name on a task is a space label", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const tasks = yield* Task.Service
      const o = yield* org
      const build = yield* o.agentIn(o.ada, o.factory.id)
      const task = yield* tasks.create(build, { spaceId: o.factory.id, title: "Fix it", labels: ["Feature"] })
      expect(task.labels.map((label) => label.name)).toEqual(["Feature"])
      const feature = (yield* labels.list(build, { ...page, spaceId: o.factory.id })).items.find(
        (label) => label.name === "Feature",
      )
      expect(feature?.spaceId).toBe(o.factory.id)
      if (!feature) return yield* Effect.die(new Error("The task made no label"))
      expect((yield* labels.archive(build, feature.id)).archivedAt).not.toBeNull()
      expect((yield* Effect.flip(labels.create(build, { name: "Org" })))._tag).toBe("Primitive.Forbidden")
    }),
  )

  it.live("a task that moves to another space drops the labels of the space it leaves (AC8)", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const members = yield* SpaceMember.Service
      const labels = yield* Label.Service
      const o = yield* org
      yield* members.create(o.grace, { spaceId: o.eng.id, userId: o.ada.userId })
      yield* labels.create(o.admin, { name: "Org" })
      const task = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Move me", labels: ["Org", "Local"] })
      const moved = yield* tasks.assign(o.ada, task.id, { spaceId: o.eng.id, start: "none" })
      expect(moved.labels.map((label) => label.name)).toEqual(["Org"])
    }),
  )

  it.live("system labels cannot change, and another organization's labels never show", () =>
    Effect.gen(function* () {
      const labels = yield* Label.Service
      const o = yield* org
      const outsider = yield* Seed.actor(yield* Seed.organization(), "admin")
      const theirs = yield* labels.create(outsider, { name: "Secret" })
      const system = (yield* labels.list(o.ada, { page: 1, pageSize: 100 })).items.filter((label) => label.isSystem)
      expect(system.map((label) => label.name)).toEqual(["ren-fix", "ren-improve"])
      for (const label of system) {
        expect((yield* Effect.flip(labels.update(o.admin, label.id, { color: "#000000" })))._tag).toBe(
          "Primitive.Forbidden",
        )
        expect((yield* Effect.flip(labels.archive(o.admin, label.id)))._tag).toBe("Primitive.Forbidden")
      }
      expect((yield* Effect.flip(labels.update(o.ada, theirs.id, { name: "Mine" })))._tag).toBe("Primitive.NotFound")
    }),
  )

  it.live("archiving a label takes it off every task", () =>
    Effect.gen(function* () {
      const tasks = yield* Task.Service
      const labels = yield* Label.Service
      const o = yield* org
      const created = yield* tasks.create(o.ada, { spaceId: o.factory.id, title: "Add SSO", labels: ["Bug"] })
      const bug = created.labels.at(0)
      if (!bug) return yield* Effect.die(new Error("The task has no label"))
      yield* labels.archive(o.ada, bug.id)
      expect((yield* tasks.get(o.ada, created.id)).labels).toEqual([])
    }),
  )
})

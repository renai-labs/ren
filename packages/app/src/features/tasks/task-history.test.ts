import { expect, test } from "bun:test"
import type { TaskActivityInfo, TaskEventData } from "@ren/client"
import { TaskHistory } from "./task-history.js"

const event = (id: string, data: TaskEventData, userId = "user"): TaskActivityInfo => ({
  id,
  type: "event",
  event: {
    id,
    taskId: "task",
    data,
    actor: { userId, agentId: null, sessionId: null },
    createdAt: "2026-01-01T00:00:00Z",
  },
})

test("status chains collapse only for the same actor and stop at review boundaries", () => {
  const rows = TaskHistory.groups([
    event("1", { _tag: "status", from: "todo", to: "in_progress" }),
    event("2", { _tag: "status", from: "in_progress", to: "done" }),
    event("3", { _tag: "status", from: "done", to: "todo" }, "other"),
    event("4", { _tag: "review_requested", reason: "Approve" }),
    event("5", { _tag: "status", from: "todo", to: "in_progress" }),
  ])
  expect(rows.map((row) => row.items.length)).toEqual([2, 1, 1])
  expect(rows[0]?.items[0]).toMatchObject({ event: { data: { from: "todo", to: "done" } } })
})

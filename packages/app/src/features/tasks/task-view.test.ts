import { expect, test } from "bun:test"
import type { TaskInfo } from "@ren/client"
import type { TaskTurnProps } from "@ren/ui/task-turn"
import { TaskView } from "./task-view.js"

const task = (fields: Partial<TaskInfo>): TaskInfo => ({
  id: "tsk_1",
  organizationId: "org",
  spaceId: "spc",
  number: 1,
  identifier: "REN-1",
  title: "Add SSO",
  description: null,
  status: "todo",
  priority: null,
  humanReview: false,
  humanReviewReason: null,
  dueAt: null,
  agentId: null,
  ownerId: null,
  session: null,
  labels: [],
  links: [],
  createdBy: { userId: "usr_me", agentId: null, sessionId: null },
  canUpdate: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  ...fields,
})

const names = { agent: (id: string) => ({ agt_plan: "Plan", agt_build: "Build" })[id], owner: () => "Shrey" }
const session = (state: "working" | "idle" | "failed") => ({ id: "ses_1", state })

const cases: ReadonlyArray<[string, TaskInfo, TaskTurnProps]> = [
  ["a new task", task({}), { state: "not_started" }],
  ["an agent that has not started", task({ agentId: "agt_plan" }), { state: "not_started", name: "Plan" }],
  [
    "a working agent",
    task({ agentId: "agt_plan", status: "in_progress", session: session("working") }),
    { state: "working", name: "Plan" },
  ],
  [
    "a review that waits on the owner",
    task({
      agentId: "agt_plan",
      ownerId: "usr_shrey",
      status: "in_progress",
      session: session("idle"),
      humanReview: true,
      humanReviewReason: "Plan approval\nOpen risks",
    }),
    { state: "needs_you", name: "Shrey", reason: "Plan approval\nOpen risks" },
  ],
  [
    "a review with no owner",
    task({ agentId: "agt_plan", status: "in_progress", humanReview: true, humanReviewReason: "Ready to merge" }),
    { state: "needs_you", name: undefined, reason: "Ready to merge" },
  ],
  [
    "an agent that stopped with an error",
    task({ agentId: "agt_build", status: "in_progress", session: session("failed") }),
    { state: "stopped", name: "Build" },
  ],
  [
    "an idle agent",
    task({ agentId: "agt_build", status: "in_progress", session: session("idle") }),
    { state: "idle", name: "Build" },
  ],
  [
    "an owner who took the task over",
    task({ ownerId: "usr_shrey", status: "in_progress" }),
    { state: "owner_working", name: "Shrey" },
  ],
  ["a done task", task({ agentId: "agt_build", status: "done", session: session("idle") }), { state: "done" }],
  ["a dismissed task", task({ status: "dismissed", humanReview: true }), { state: "dismissed" }],
]

test.each(cases)("the turn line for %s", (_, input, expected) => {
  expect(TaskView.turn(input, { ...names, userId: "usr_me" })).toEqual(expected)
})

test("a review that waits on the current user says you", () => {
  const input = task({ ownerId: "usr_me", status: "in_progress", humanReview: true, humanReviewReason: "Merge" })
  expect(TaskView.turn(input, { ...names, userId: "usr_me" })).toEqual({
    state: "needs_you",
    name: undefined,
    reason: "Merge",
  })
})

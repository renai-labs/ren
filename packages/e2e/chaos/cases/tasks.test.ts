import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Agent } from "@ren/core/agent"
import { Seed } from "@ren/core/testing"
import { HostTasks } from "@ren/host-api/tasks"
import { Task } from "@ren/schema/task"
import { Effect, Schema } from "effect"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)("task handoff end to end", () => {
  const lane: { stack?: RealStack.Instance } = {}
  beforeAll(async () => {
    lane.stack = await RealStack.start({ environments: [{ label: "tasks" }] })
    await lane.stack.run(Seed.member(lane.stack.owner.organizationId, lane.stack.owner.createdBy, "admin"))
  }, 600_000)
  afterAll(() => lane.stack?.dispose(), 120_000)

  test("an agent creates a task and hands it off; the receiving agent works in its own session", async () => {
    const stack = lane.stack
    if (!stack) throw new Error("The stack did not start")
    const agents = await stack.run(
      Effect.gen(function* () {
        const service = yield* Agent.Service
        const actor = { userId: stack.owner.createdBy, organizationId: stack.owner.organizationId, roles: ["admin"] }
        const create = (name: string) =>
          service.create(actor, {
            ownerSpaceId: stack.owner.spaceId,
            name,
            isSubagent: false,
            settings: { permissions: [], references: [], instructions: `You are ${name}.` },
          })
        return { plan: yield* create("planner"), build: yield* create("builder") }
      }),
    )
    const plan = await stack.session({ environment: false, agentId: agents.plan.id })
    const created = await plan.tool("task_create", { title: "Build task tools", description: "Keep this request." })
    const task = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(Task.Info)))(created)
    expect(task.createdBy).toMatchObject({ agentId: agents.plan.id, sessionId: plan.sessionId })
    const receiving = stack.provider.script([
      ModelProvider.tool("task_comment", { taskId: task.id, body: "Build received the handoff." }),
      ModelProvider.text("Received"),
    ])
    const assigned = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(HostTasks.AssignResult)))(
      await plan.tool("task_assign", {
        id: task.id,
        agentId: agents.build.id,
        note: `Build your part. ${receiving.marker}`,
      }),
    )
    expect(assigned.task).toMatchObject({
      agentId: agents.build.id,
      description: "Keep this request.",
      status: "in_progress",
    })
    expect(assigned.task.session?.id).toBeDefined()
    expect(assigned.task.session?.id).not.toBe(plan.sessionId)
    const call = await receiving.called(2, 60_000)
    expect(call.system).toContain("You are builder.")
    const read = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.toCodecJson(HostTasks.GetResult)))(
      await plan.tool("task_get", { id: task.id }),
    )
    expect(read.activity.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "comment",
          comment: expect.objectContaining({
            body: "Build received the handoff.",
            author: expect.objectContaining({ agentId: agents.build.id, sessionId: assigned.task.session?.id }),
          }),
        }),
      ]),
    )
  }, 600_000)
})

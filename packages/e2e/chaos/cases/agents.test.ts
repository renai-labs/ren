import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Actor } from "@ren/core/actor"
import { Agent } from "@ren/core/agent"
import { OrganizationSettings } from "@ren/core/organization-settings"
import { SpaceSettings } from "@ren/core/space/settings"
import { Seed } from "@ren/core/testing"
import type { Settings } from "@ren/schema/settings"
import { Effect } from "effect"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"

const settings = (input: Partial<Settings.Info>): Settings.Info => ({ permissions: [], references: [], ...input })

const renText = "This is an automated test."

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)("agents end to end", () => {
  const lane: { stack?: RealStack.Instance; admin?: Actor.Info } = {}
  const current = () => {
    if (!lane.stack || !lane.admin) throw new Error("the stack did not start")
    return { stack: lane.stack, admin: lane.admin }
  }
  const createAgent = (name: string, instructions: string) =>
    current().stack.run(
      Agent.Service.use((agents) =>
        agents.create(current().admin, {
          ownerSpaceId: current().stack.owner.spaceId,
          name,
          isSubagent: false,
          settings: settings({ instructions }),
        }),
      ),
    )
  const modelCall = async (session: RealStack.Driver, text: string) => {
    const turn = await session.turn([ModelProvider.text("ok")], text)
    const call = await turn.called(1, 60_000)
    await session.settled()
    return call
  }
  const agentOf = async (session: RealStack.Driver) =>
    (await session.opencode.session.get({ sessionID: session.sessionId })).agent

  beforeAll(async () => {
    lane.stack = await RealStack.start({ environments: [{ label: "agents" }] })
    lane.admin = await lane.stack.run(Seed.actor(lane.stack.owner.organizationId, "admin"))
  }, 600_000)

  afterAll(() => lane.stack?.dispose(), 120_000)

  test("a Ren session's model request has the instructions of Ren, its organization and its space", async () => {
    const stack = current().stack
    await stack.run(
      Effect.gen(function* () {
        yield* OrganizationSettings.Service.use((service) =>
          service.update(current().admin, stack.owner.organizationId, {
            settings: settings({ instructions: "Never print secrets." }),
          }),
        )
        yield* SpaceSettings.Service.use((service) =>
          service.update(current().admin, stack.owner.spaceId, { settings: settings({ instructions: "We use Bun." }) }),
        )
      }),
    )
    const session = await stack.session({ environment: false })
    const call = await modelCall(session, "work")
    expect([
      call.model,
      call.system.includes(renText),
      call.system.includes("Never print secrets."),
      call.system.includes("We use Bun."),
    ]).toEqual(["stub-model", true, true, true])
    expect(await agentOf(session)).toBe("ren")
  }, 600_000)

  test("a session started with an agent runs as it, and an edit of the agent between two turns reaches the next turn", async () => {
    const stack = current().stack
    const agent = await createAgent("build", "You are Build.")
    const session = await stack.session({ environment: false, agentId: agent.id })
    const first = await modelCall(session, "work")
    expect([first.system.includes(renText), first.system.includes("You are Build.")]).toEqual([true, true])
    expect(await agentOf(session)).toBe("build")
    await stack.run(
      Agent.Service.use((agents) =>
        agents.update(current().admin, agent.id, { settings: settings({ instructions: "You are Build 2." }) }),
      ),
    )
    const second = await modelCall(session, "next")
    expect([second.system.includes("You are Build 2."), second.system.includes("You are Build.")]).toEqual([
      true,
      false,
    ])
  }, 600_000)

  test("after its agent is archived, a session's next turn runs as Ren", async () => {
    const stack = current().stack
    const agent = await createAgent("review", "You are Review.")
    const session = await stack.session({ environment: false, agentId: agent.id })
    expect((await modelCall(session, "work")).system).toContain("You are Review.")
    await stack.run(Agent.Service.use((agents) => agents.archive(current().admin, agent.id)))
    const next = await modelCall(session, "next")
    expect([next.system.includes(renText), next.system.includes("You are Review.")]).toEqual([true, false])
    expect(await agentOf(session)).toBe("ren")
  }, 600_000)

  test("a space rule that denies rm refuses that shell call in the container, and other commands still run", async () => {
    const stack = current().stack
    await stack.run(
      SpaceSettings.Service.use((service) =>
        service.update(current().admin, stack.owner.spaceId, {
          settings: settings({ permissions: [{ action: "shell", resource: "rm *", effect: "deny" }] }),
        }),
      ),
    )
    const session = await stack.session()
    expect(await session.tool("shell", { command: "echo kept > kept.txt" })).toBe("(no output)")
    expect(await session.tool("shell", { command: "rm kept.txt" })).toContain("Permission denied: shell")
    expect(await session.tool("shell", { command: "cat kept.txt" })).toBe("kept\n")
  }, 600_000)
})

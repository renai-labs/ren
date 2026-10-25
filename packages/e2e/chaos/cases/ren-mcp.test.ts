import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Actor } from "@ren/core/actor"
import { Agent } from "@ren/core/agent"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"

const CreatedBy = Schema.Array(
  Schema.Struct({ user: Schema.NullOr(Schema.String), agent: Schema.NullOr(Schema.String), session: Schema.String }),
)

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)("Ren MCP from a brain", () => {
  const lane: { stack?: RealStack.Instance; admin?: Actor.Info } = {}
  const current = () => {
    if (!lane.stack || !lane.admin) throw new Error("the stack did not start")
    return { stack: lane.stack, admin: lane.admin }
  }

  beforeAll(async () => {
    lane.stack = await RealStack.start({ environments: [{ label: "ren-mcp" }] })
    lane.admin = await lane.stack.run(Seed.actor(lane.stack.owner.organizationId, "admin"))
  }, 600_000)

  afterAll(() => lane.stack?.dispose(), 120_000)

  test("the agent creates tasks through Ren MCP as the sender of each turn, with its agent and its chat", async () => {
    const stack = current().stack
    const member = await stack.run(
      Effect.gen(function* () {
        const database = yield* Database.Service
        const joined = yield* Seed.actor(stack.owner.organizationId, "member")
        yield* database.db
          .insert(Database.Schema.space_member)
          .values({ id: Space.MembershipID.create(), space_id: stack.owner.spaceId, user_id: joined.userId })
        return joined.userId
      }),
    )
    const agent = await stack.run(
      Agent.Service.use((agents) =>
        agents.create(current().admin, {
          ownerSpaceId: stack.owner.spaceId,
          name: "planner",
          isSubagent: false,
          settings: { permissions: [], references: [], instructions: "You plan." },
        }),
      ),
    )
    const session = await stack.session({ environment: false, agentId: agent.id })
    const create = async (title: string, sender: typeof member) => {
      const code = `return await tools.ren.task_create(${JSON.stringify({ spaceId: stack.owner.spaceId, title })})`
      const turn = await session.turn([ModelProvider.tool("execute", { code }), ModelProvider.text("ok")], "work", {
        sender,
      })
      const first = await turn.called(1, 120_000)
      const second = await turn.called(2, 120_000)
      await session.idle(60_000)
      return { system: first.system, result: second.toolResults }
    }
    const byMember = await create(`by member ${crypto.randomUUID()}`, member)
    expect(byMember.system).toContain('<server name="ren">')
    expect(byMember.result).toContain("by member")
    const byOwner = await create(`by owner ${crypto.randomUUID()}`, stack.owner.createdBy)
    expect(byOwner.result).toContain("by owner")
    const rows = await stack.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return Schema.decodeUnknownSync(CreatedBy)(
          yield* sql`select created_by_user_id as "user", created_by_agent_id as "agent", created_by_session_id as "session"
                     from task where space_id = ${stack.owner.spaceId} order by created_at`,
        )
      }),
    )
    expect(rows).toEqual([
      { user: member, agent: agent.id, session: session.sessionId },
      { user: stack.owner.createdBy, agent: agent.id, session: session.sessionId },
    ])
    expect(stack.renProxy.count(/^POST \/mcp$/)).toBeGreaterThan(0)
  }, 600_000)
})

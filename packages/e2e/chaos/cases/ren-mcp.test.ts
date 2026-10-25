import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Seed } from "@ren/core/testing"
import { Database } from "@ren/db/database"
import { Space } from "@ren/schema/space"
import { Effect, Schema } from "effect"
import { SqlClient } from "effect/sql"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { RealStack } from "../lib/real-stack.js"

const Creators = Schema.Array(Schema.Struct({ user: Schema.String }))

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined)("Ren MCP from a brain", () => {
  const lane: { stack?: RealStack.Instance } = {}
  const current = () => {
    if (!lane.stack) throw new Error("the stack did not start")
    return lane.stack
  }

  beforeAll(async () => {
    lane.stack = await RealStack.start({ environments: [{ label: "ren-mcp" }] })
  }, 600_000)

  afterAll(() => lane.stack?.dispose(), 120_000)

  test("the agent calls Ren MCP as the sender of each turn", async () => {
    const stack = current()
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
    const session = await stack.session({ environment: false })
    const create = async (title: string, sender: typeof member) => {
      const code = `return await tools.ren.task_create(${JSON.stringify({ spaceId: stack.owner.spaceId, title })})`
      const turn = await session.turn([ModelProvider.tool("execute", { code }), ModelProvider.text("ok")], "work", {
        sender,
      })
      const result = (await turn.called(2, 120_000)).toolResults
      await session.idle(60_000)
      return result
    }
    expect(await create(`by member ${crypto.randomUUID()}`, member)).toContain("by member")
    expect(await create(`by owner ${crypto.randomUUID()}`, stack.owner.createdBy)).toContain("by owner")
    const creators = await stack.run(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        return Schema.decodeUnknownSync(Creators)(
          yield* sql`select created_by_user_id as "user" from task where space_id = ${stack.owner.spaceId} order by created_at`,
        )
      }),
    )
    expect(creators).toEqual([{ user: member }, { user: stack.owner.createdBy }])
  }, 600_000)
})

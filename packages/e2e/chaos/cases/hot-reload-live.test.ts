import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { Models } from "@ren/schema/models"
import { Redacted, Schema, Struct } from "effect"
import { Platform } from "../lib/platform.js"
import { LiteLLM } from "../lib/provider/litellm.js"
import { RealStack } from "../lib/real-stack.js"
import { Wait } from "../lib/wait.js"

// oxlint-disable-next-line ren/no-comments -- A small model that every key of this lane may use, in LiteLLM's model_name.
const small = "anthropic/claude-haiku-5-5"

const added = "openai/gpt-5.6-terra"

// oxlint-disable-next-line ren/no-comments -- spec §9 V5: the brain reads LiteLLM every 30 s; one read interval and a margin.
const readWithinMs = 45_000

const accessFor = async (key: string): Promise<Models.Access> => {
  const response = await fetch(`${LiteLLM.url}/model/info`, { headers: { authorization: `Bearer ${key}` } })
  const catalog = Models.fromLiteLLM(Schema.decodeUnknownSync(Models.LiteLLMModelInfo)(await response.json()))
  return {
    endpoints: catalog.endpoints.map((endpoint) =>
      Struct.assign(endpoint, { baseUrl: `${LiteLLM.url}/v1`, apiKey: { key: Redacted.make(key) } }),
    ),
  }
}

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined || Platform.litellm !== undefined)(
  "hot reload of models from a live LiteLLM (spec §9.1 C13, C14)",
  () => {
    const lane: { stack?: RealStack.Instance; wide?: string; narrow?: string } = {}

    const current = () => {
      if (!lane.stack || !lane.wide || !lane.narrow) throw new Error("the stack did not start")
      return { stack: lane.stack, wide: lane.wide, narrow: lane.narrow }
    }

    beforeAll(async () => {
      lane.wide = await LiteLLM.generate({ duration: "2h", models: [] })
      lane.narrow = await LiteLLM.generate({ duration: "2h", models: [small] })
      lane.stack = await RealStack.start({
        environments: [{ label: "hot-reload-live" }],
        models: await accessFor(lane.narrow),
        cellVars: { OPENCODE_CONFIG: "{}" },
      })
      await lane.stack.sql`
        INSERT INTO settings (space_id, settings)
        VALUES (${lane.stack.owner.spaceId}, ${JSON.stringify({ model: { endpointId: "anthropic", modelId: "claude-haiku-5-5" }, permissions: [], references: [] })}::text::jsonb)
        ON CONFLICT (owner_id) DO UPDATE SET settings = excluded.settings`
    }, 600_000)

    afterAll(async () => {
      await lane.stack?.dispose()
      await Promise.all([lane.wide, lane.narrow].flatMap((key) => (key ? [LiteLLM.remove(key)] : [])))
    }, 120_000)

    const listed = async (session: RealStack.Driver) =>
      (await session.chat.model.list()).map((model) => `${model.providerID}/${model.id}`).toSorted()

    const started = async (key: string) => {
      const session = await current().stack.session({ models: await accessFor(key), environment: false })
      await session.start({ withoutEnvironment: true })
      return session
    }

    test("C14: each brain lists only the models of its own LiteLLM key", async () => {
      const wide = await started(current().wide)
      const narrow = await started(current().narrow)
      const wideList = await listed(wide)
      expect(await listed(narrow)).toEqual(["anthropic/claude-haiku-5-5"])
      expect(wideList).toContain("anthropic/claude-haiku-5-5")
      expect(wideList.length).toBeGreaterThan(1)
    }, 600_000)

    test("C13: a model added to the key reaches a running brain in one read, and a removed one leaves it", async () => {
      const session = await started(current().narrow)
      await session.send("Answer with one word: ready.")
      await session.idle(120_000)
      await LiteLLM.allow(current().narrow, [small, added])
      try {
        await Wait.until("the added model in the brain's list", readWithinMs, async () =>
          (await listed(session)).includes("openai/gpt-5.6-terra") ? true : undefined,
        )
      } finally {
        await LiteLLM.allow(current().narrow, [small])
      }
      await Wait.until("the removed model to leave the brain's list", readWithinMs, async () =>
        (await listed(session)).includes("openai/gpt-5.6-terra") ? undefined : true,
      )
      await session.send("Answer with one word: still.")
      await session.idle(120_000)
      const page = await session.chat.session.messages({ sessionID: session.sessionId, limit: 10 })
      expect(JSON.stringify(page)).toContain('"type":"assistant"')
    }, 600_000)
  },
)

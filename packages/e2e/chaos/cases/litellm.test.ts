import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test"
import type { Models } from "@ren/schema/models"
import { DateTime, Redacted } from "effect"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { LiteLLM } from "../lib/provider/litellm.js"
import { Stack } from "../lib/stack.js"

const model = (process.env.CHAOS_LIVE_MODEL ?? "").split("/").slice(1).join("/")

const bridge = (key: string, expiresAtMs?: number): Models.Access => ({
  endpoints: [
    {
      id: "bridge",
      protocol: "openai-chat",
      baseUrl: LiteLLM.url,
      apiKey: {
        key: Redacted.make(key),
        ...(expiresAtMs !== undefined && { expiresAt: DateTime.makeUnsafe(expiresAtMs) }),
      },
      models: [{ id: model, name: model, limit: { context: 100_000, output: 4000 } }],
    },
  ],
})

describe.skipIf(Platform.wrangler !== undefined || Platform.live !== undefined || Platform.litellm !== undefined)(
  "isolated LiteLLM keys",
  () => {
    const lane: { stack?: Stack.Instance } = {}
    const issued: Array<string> = []

    const stack = () => {
      if (!lane.stack) throw new Error("the stack did not start")
      return lane.stack
    }

    beforeAll(async () => {
      lane.stack = await Stack.start()
    }, 180_000)

    afterEach(async () => {
      await Promise.allSettled(issued.splice(0).map((key) => LiteLLM.remove(key)))
    })

    afterAll(() => lane.stack?.dispose())

    const session = (access: Models.Access) =>
      stack().session({ models: access, start: { model: { endpointId: "bridge", modelId: model } } })

    const answered = async (opened: SessionDriver.Driver, text: string) => {
      expect((await opened.send(text)).status).toBe(200)
      const idle = SessionDriver.lastIdle(await opened.settled(120_000))
      return idle?.type === "idle" ? idle.outcome : undefined
    }

    test("the cell uses an isolated key until it expires, then refuses work without calling the bridge", async () => {
      const expiresAtMs = Date.now() + 30_000
      const key = await LiteLLM.generate({ duration: "30s", models: [model] })
      issued.push(key)
      const opened = await session(bridge(key, expiresAtMs))
      expect(await answered(opened, "Reply with OK.")).toBe("succeeded")
      // ast-grep-ignore: no-test-sleep -- LiteLLM's key expiry runs on the bridge's clock
      await Bun.sleep(Math.max(0, expiresAtMs - Date.now()) + 1_000)
      expect((await opened.send("Reply with OK again.")).status).toBe(409)
    }, 180_000)

    test("a key revoked during a session stops new turns and the admin credential still works", async () => {
      const key = await LiteLLM.generate({ duration: "10m", models: [model] })
      const opened = await session(bridge(key))
      expect(await answered(opened, "Reply with OK.")).toBe("succeeded")
      expect(await LiteLLM.remove(key)).toBe(200)
      expect(await answered(opened, "Reply with OK after revocation.")).not.toBe("succeeded")
      expect(await LiteLLM.exists(key)).toBe(false)
    }, 180_000)
  },
)

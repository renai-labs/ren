import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { BunBrain, Shared, StubModel } from "@ren/cell/testing"
import { Brain } from "@ren/schema/brain"
import { SessionDriver } from "../lib/drivers/session.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const retries = 10

const windowMs = 5 * 60_000

describe.skipIf(Platform.wrangler !== undefined)("the model provider link", () => {
  const lane: { stack?: Stack.Instance; environment?: Stack.Environment; sandbox?: BunBrain.Instance } = {}

  const current = () => {
    if (!lane.stack || !lane.environment) throw new Error("the stack did not start")
    return { stack: lane.stack, environment: lane.environment }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.environment = await lane.stack.environment("model-provider")
  }, 180_000)

  afterAll(() => Promise.all([lane.sandbox?.dispose(), lane.stack?.dispose()]))

  const attached = () => current().stack.session({ environment: current().environment })

  test("a 429 with Retry-After is retried after the delay and the turn completes", async () => {
    const session = await current().stack.session()
    const turn = await session.turn([
      ModelProvider.status(429, { "retry-after": "1" }),
      ModelProvider.text("after the limit"),
    ])
    const second = await turn.script.called(2, 60_000)
    expect(second.at - (turn.script.calls[0]?.at ?? second.at)).toBeGreaterThanOrEqual(900)
    expect(SessionDriver.assistantTexts(await session.settled()).join("")).toContain("after the limit")
  })

  test.skipIf(Platform.slow !== undefined)(
    `persistent 5xx replies stop after OpenCode's ${retries} retries`,
    async () => {
      const session = await current().stack.session()
      const turn = await session.turn(Array.from({ length: retries + 2 }, () => ModelProvider.status(503)))
      await turn.script.called(1)
      await Wait.until("the failing turn to stop", 150_000, async () =>
        Object.hasOwn(await session.opencode.session.active(), session.id) ? undefined : true,
      )
      expect(turn.script.calls).toHaveLength(retries + 1)
    },
    200_000,
  )

  test.each([
    ["after the headers", "headers"],
    ["in the middle of text", "text"],
  ] as const)("a stream cut %s is retried and the turn ends", async (_name, after) => {
    const session = await current().stack.session()
    const turn = await session.turn([ModelProvider.cut(after), ModelProvider.text("retried")])
    await turn.script.called(1)
    expect(SessionDriver.lastIdle(await session.settled(90_000))).toBeDefined()
    expect(turn.script.calls.length).toBeLessThanOrEqual(retries + 1)
  })

  test("a stream cut after a tool ran never repeats the tool's effect", async () => {
    const session = await attached()
    const marker = Ledger.marker("cut-after-tool")
    const turn = await session.turn([
      ModelProvider.tool("shell", { command: Ledger.append(marker) }),
      ModelProvider.cut("text"),
      ModelProvider.text("retried"),
    ])
    await turn.script.called(2, 60_000)
    await session.settled(90_000)
    expect(await Ledger.count(current().environment.instance, marker)).toBe(1)
  })

  test.each([
    ["a malformed frame", [{ type: "malformed-frame" }]],
    ["malformed tool arguments", [{ type: "malformed-arguments", name: "shell" }]],
    ["an unknown tool", [ModelProvider.tool("chaos_unknown_tool", { anything: true }), ModelProvider.text("after")]],
    ["an early end of stream", [{ type: "eof" }]],
  ] as const)(
    "%s ends the turn without running anything on the environment",
    async (_name, steps) => {
      const session = await attached()
      const before = current().environment.proxy.count("process.spawn")
      const turn = await session.turn(steps)
      await turn.script.called(1)
      expect(SessionDriver.lastIdle(await session.settled(150_000))).toBeDefined()
      expect(current().environment.proxy.count("process.spawn")).toBe(before)
    },
    180_000,
  )

  test("on a sandbox brain, an OpenAI endpoint whose WebSocket closes with 1011 is never opened: the first turn is one HTTP call", async () => {
    const stack = current().stack
    const gpt = StubModel.modelEntry("openai", "chaos-gpt")
    stack.provider.modelInfo.set([
      ...StubModel.defaultModels,
      { ...gpt, model_info: { ...gpt.model_info, mode: "responses" } },
    ])
    // oxlint-disable-next-line ren/no-comments -- A workerd cell never opens a model WebSocket; a sandbox brain does. The fault proxy refuses every upgrade, so the brain calls the stub itself.
    lane.sandbox = await BunBrain.make(
      { ...Shared.vars(stack.provider.url), REN_URL: stack.ren.url },
      { brain: Brain.ID.create() },
    )
    const brain = lane.sandbox.brain
    const session = await SessionDriver.make(
      { kind: "bun", url: lane.sandbox.url, ren: stack.ren, brain: () => brain },
      stack.provider,
    )
    const configured = await session.configureModels(
      Shared.access({ openai: Shared.apiKey(Stack.freshKey("openai")) }, stack.provider.url),
    )
    expect(configured.status).toBe(204)
    expect((await session.start({ model: { endpointId: "openai", modelId: "chaos-gpt" } })).status).toBe(200)
    const turn = await session.turn([ModelProvider.text("over http")])
    expect(SessionDriver.assistantTexts(await session.settled(90_000)).join("")).toContain("over http")
    expect({ upgrades: stack.provider.upgrades, calls: turn.script.calls.length }).toEqual({ upgrades: [], calls: 1 })
  })

  test("a turn longer than several short grants renews the key before each model call, with no client attached", async () => {
    const stack = current().stack
    const issued: Array<string> = []
    stack.ren.refresh(() => {
      const key = Stack.freshKey("short")
      issued.push(key)
      return { type: "grant", access: stack.access(key, Date.now() + windowMs + 2_000) }
    })
    const session = await stack.session({
      models: stack.access(Stack.freshKey("start"), Date.now() + windowMs - 60_000),
      environment: current().environment,
    })
    const turn = await session.turn([
      ...Array.from({ length: 3 }, () => ModelProvider.tool("shell", { command: "sleep 3" })),
      ModelProvider.text("finished"),
    ])
    await turn.script.called(4, 60_000)
    await session.closed(60_000)
    const used = turn.script.calls.map((call) => call.key)
    expect(used.filter((key) => key === undefined || !issued.includes(key))).toEqual([])
    expect(new Set(used).size).toBe(used.length)
  })
})

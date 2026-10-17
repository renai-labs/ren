import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { SessionDriver } from "../lib/drivers/session.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const retries = 10

const windowMs = 5 * 60_000

describe.skipIf(Platform.wrangler !== undefined)("the model provider link", () => {
  const lane: { stack?: Stack.Instance; hand?: Stack.Hand } = {}

  const current = () => {
    if (!lane.stack || !lane.hand) throw new Error("the stack did not start")
    return { stack: lane.stack, hand: lane.hand }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.hand = await lane.stack.hand("model-provider")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const attached = () => current().stack.session({ hand: current().hand })

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
    expect(await Ledger.count(current().hand.instance, marker)).toBe(1)
  })

  test.each([
    ["a malformed frame", [{ type: "malformed-frame" }]],
    ["malformed tool arguments", [{ type: "malformed-arguments", name: "shell" }]],
    ["an unknown tool", [ModelProvider.tool("chaos_unknown_tool", { anything: true }), ModelProvider.text("after")]],
    ["an early end of stream", [{ type: "eof" }]],
  ] as const)(
    "%s ends the turn without running anything on the hand",
    async (_name, steps) => {
      const session = await attached()
      const before = current().hand.proxy.count("process.spawn")
      const turn = await session.turn(steps)
      await turn.script.called(1)
      expect(SessionDriver.lastIdle(await session.settled(150_000))).toBeDefined()
      expect(current().hand.proxy.count("process.spawn")).toBe(before)
    },
    180_000,
  )

  test("a turn longer than several short grants renews the key before each model call, with no client attached", async () => {
    const stack = current().stack
    const issued: Array<string> = []
    stack.issuer.next(() => {
      const key = Stack.freshKey("short")
      issued.push(key)
      return { type: "grant", access: stack.access(key, Date.now() + windowMs + 2_000) }
    })
    const session = await stack.session({
      models: stack.access(Stack.freshKey("start"), Date.now() + windowMs - 60_000),
      hand: current().hand,
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

  test("invalid model updates are refused and the acknowledged catalog and key stay in use", async () => {
    const stack = current().stack
    const key = Stack.freshKey("valid")
    const session = await stack.session({ models: stack.access(key) })
    const listed = async () =>
      (await session.opencode.model.list()).data
        .filter((model) => model.providerID === "stub")
        .map((model) => model.modelID)
        .toSorted()
    const before = await listed()
    const endpoint = {
      id: "stub",
      protocol: "openai-chat",
      baseUrl: "http://127.0.0.1:1",
      apiKey: { key: "x" },
      models: [],
    }
    const bodies = [
      { access: { endpoints: [{ ...endpoint, baseUrl: "ftp://nowhere" }] } },
      { access: { endpoints: [{ ...endpoint, protocol: "smoke-signals" }] } },
      { access: { endpoints: [{ id: "stub", protocol: "openai-chat", baseUrl: "http://127.0.0.1:1", models: [] }] } },
      { access: { endpoints: [endpoint, { ...endpoint, apiKey: { key: "y" } }] } },
    ]
    const statuses = await Promise.all(
      bodies.map(
        async (body) =>
          (
            await fetch(`${stack.cellProxy.url}/ren/models`, {
              method: "PUT",
              headers: { authorization: session.server, "content-type": "application/json" },
              body: JSON.stringify(body),
            })
          ).status,
      ),
    )
    expect(statuses).toEqual(bodies.map(() => 400))
    expect(await listed()).toEqual(before)
    const turn = await session.turn([ModelProvider.text("still configured")])
    expect((await turn.script.called(1)).key).toBe(key)
  })
})

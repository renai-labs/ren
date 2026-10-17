import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { TestToken } from "@ren/cell/testing"
import { Result } from "effect"
import { CloudflareBrain } from "../lib/adapters/cloudflare.js"
import { SessionDriver } from "../lib/drivers/session.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { Process } from "../lib/process.js"
import { LiveModel } from "../lib/provider/live.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

describe.skipIf(Platform.wrangler !== undefined || Platform.soak !== undefined)("a soaked local cell", () => {
  const lane: { stack?: Stack.Instance; hand?: Stack.Hand } = {}

  const current = () => {
    if (!lane.stack || !lane.hand) throw new Error("the stack did not start")
    return { stack: lane.stack, hand: lane.hand }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.hand = await lane.stack.hand("soak")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const cycle = async (label: string) => {
    const session = await current().stack.session({ start: { environments: [current().hand.location()] } })
    const marker = Ledger.marker(label)
    const turn = await session.turn([
      ModelProvider.tool("shell", { command: Ledger.append(marker) }),
      ModelProvider.text("ok"),
    ])
    await turn.script.called(2, 60_000)
    await session.closed(120_000)
    return Ledger.count(current().hand.instance, marker)
  }

  const rss = () => {
    const pid = current().stack.cell.pid()
    if (pid === undefined) return 0
    return [pid, ...Process.childPids(pid)].reduce((total, member) => {
      const value = Number(
        Bun.spawnSync(["ps", "-o", "rss=", "-p", String(member)])
          .stdout.toString()
          .trim(),
      )
      return Number.isFinite(value) ? total + value : total
    }, 0)
  }

  test("1, 2, 5 and 10 concurrent sessions each run their tool once and close", async () => {
    const counts = await [1, 2, 5, 10].reduce<Promise<ReadonlyArray<ReadonlyArray<number>>>>(
      async (previous, width) => [
        ...(await previous),
        await Promise.all(Array.from({ length: width }, (_, index) => cycle(`ramp-${width}-${index}`))),
      ],
      Promise.resolve([]),
    )
    expect(counts.flat().filter((count) => count !== 1)).toEqual([])
  }, 1_800_000)

  test("repeated cycles keep every tool effect once and the workerd memory within twice its baseline", async () => {
    const end = Date.now() + Number(process.env.CHAOS_SOAK_MS)
    const loop = async (memory: ReadonlyArray<number>): Promise<ReadonlyArray<number>> => {
      if (Date.now() > end) return memory
      expect(await cycle(`soak-${memory.length}`)).toBe(1)
      return loop([...memory, rss()])
    }
    const memory = await loop([])
    const average = (values: ReadonlyArray<number>) =>
      values.reduce((total, value) => total + value, 0) / Math.max(1, values.length)
    expect(memory.length).toBeGreaterThan(0)
    expect(average(memory.slice(-5))).toBeLessThan(average(memory.slice(0, 5)) * 2)
  }, 0)
})

describe.skipIf(Platform.cloudflare !== undefined || Platform.live !== undefined)("a deployed cell", () => {
  const lane: {
    deployment?: Awaited<ReturnType<typeof CloudflareBrain.deploy>>
    selected?: Awaited<ReturnType<typeof LiveModel.select>>
  } = {}

  beforeAll(async () => {
    lane.selected = await LiveModel.select(process.env.CHAOS_LIVE_MODEL)
    lane.deployment = await CloudflareBrain.deploy({
      label: "soak",
      vars: { ALARM_INTERVAL_MS: "30000", WAIT_BUDGET_MS: "600000", PARK_AFTER_MS: "600000" },
      secrets: TestToken.vars,
    })
  }, 600_000)

  afterAll(() => lane.deployment?.remove())

  const session = async () => {
    const selected = lane.selected
    if (!lane.deployment || !selected) throw new Error("the deployment did not start")
    if (Result.isFailure(selected)) throw new Error(selected.failure)
    const opened = await SessionDriver.make(lane.deployment.url)
    expect((await opened.configureModels(LiveModel.access(selected.success))).status).toBe(204)
    const model = { endpointId: selected.success.providerId, modelId: selected.success.modelId }
    expect((await opened.start({ model })).status).toBe(200)
    return opened
  }

  test("a deployed session's token reaches only its own Durable Object", async () => {
    const first = await session()
    const second = await session()
    const crossed = await fetch(`${lane.deployment?.url}/api/session/${second.id}`, {
      headers: { authorization: TestToken.basic(first.client) },
    })
    expect(crossed.status).toBe(404)
    expect((await second.brain("/ren/sessions", { sessionId: first.id, harness: "opencode" })).status).toBe(403)
  }, 600_000)

  test("a redeploy during a turn leaves the session usable and its accepted message once", async () => {
    const opened = await session()
    const sent = await opened.send("Count from 1 to 50, one number per line.")
    expect(sent.status).toBe(200)
    await lane.deployment?.redeploy()
    expect((await opened.send("Reply with READY only.")).status).toBe(200)
    const read = await Wait.until("the deployed session to answer READY", 300_000, async () => {
      const messages = await opened.messages()
      return SessionDriver.assistantTexts(messages).join(" ").toUpperCase().includes("READY") ? messages : undefined
    })
    expect(SessionDriver.occurrences(read, sent.messageId)).toBe(1)
  }, 600_000)
})

import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Models } from "@ren/schema/models"
import { Result } from "effect"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { LiveModel } from "../lib/provider/live.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const instructions = {
  "chaos.limits":
    "This is an automated test. Keep every answer under 40 words. Use at most four tool calls per turn. Never ask questions.",
}

const select = async (selection: string | undefined) => {
  const selected = await LiveModel.select(selection)
  if (Result.isFailure(selected)) throw new Error(selected.failure)
  return selected.success
}

describe.skipIf(Platform.wrangler !== undefined || Platform.live !== undefined)("a live model", () => {
  const lane: { stack?: Stack.Instance; hand?: Stack.Hand; selected?: Awaited<ReturnType<typeof select>> } = {}

  const current = () => {
    if (!lane.stack || !lane.hand || !lane.selected) throw new Error("the stack did not start")
    return { stack: lane.stack, hand: lane.hand, selected: lane.selected }
  }

  beforeAll(async () => {
    lane.selected = await select(process.env.CHAOS_LIVE_MODEL)
    lane.stack = await Stack.start()
    lane.hand = await lane.stack.hand("live")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const session = () =>
    current().stack.session({
      models: LiveModel.access(current().selected),
      hand: current().hand,
      start: {
        model: { endpointId: current().selected.providerId, modelId: current().selected.modelId },
        instructions,
      },
    })

  const ask = async (opened: SessionDriver.Driver, text: string) => {
    expect((await opened.send(text)).status).toBe(200)
    return opened.settled(180_000)
  }

  const lastAnswer = (read: Awaited<ReturnType<typeof ask>>) => SessionDriver.assistantTexts(read).at(-1) ?? ""

  test("a follow-up turn uses context from the previous turn", async () => {
    const opened = await session()
    const word = `kiwi${crypto.randomUUID().slice(0, 4)}`
    await ask(opened, `Remember the code word ${word}. Reply with OK only.`)
    const read = await ask(opened, "What was the code word? Reply with the word only.")
    expect(lastAnswer(read).toLowerCase()).toContain(word.toLowerCase())
  }, 300_000)

  test("the model creates, reads and edits a file, and the file on the hand proves it", async () => {
    const opened = await session()
    const name = `live-${crypto.randomUUID().slice(0, 6)}.txt`
    const first = `alpha-${crypto.randomUUID().slice(0, 6)}`
    const second = `omega-${crypto.randomUUID().slice(0, 6)}`
    const read = await ask(
      opened,
      `Use your tools: create ${name} containing exactly ${first}, read it back, then replace ${first} with ${second}. Reply DONE.`,
    )
    expect((await current().hand.instance.observe(["cat", `${opened.sessionId}/${name}`])).stdout.trim()).toBe(second)
    expect(SessionDriver.toolNames(read).length).toBeGreaterThanOrEqual(2)
  }, 300_000)

  test("a failing command reaches the model as a failure, not a fabricated success", async () => {
    const read = await ask(
      await session(),
      "Run the shell command: sh -c 'echo failing; exit 7'. Then reply with the exit code number only.",
    )
    expect(SessionDriver.toolNames(read)).toContain("shell")
    expect(lastAnswer(read)).toContain("7")
  }, 300_000)

  test("interrupting while the model streams ends that turn and the next turn works", async () => {
    const opened = await session()
    expect((await opened.send("Count from 1 to 400, one number per line, no tools.")).status).toBe(200)
    await Wait.until("the model to start streaming", 60_000, async () =>
      SessionDriver.assistantTexts(await opened.messages()).join("").length > 0 ? true : undefined,
    )
    expect((await opened.opencode.session.interrupt({ sessionID: opened.id })).interrupted).toBe(true)
    const read = await ask(opened, "Reply with the word READY only.")
    expect(lastAnswer(read).toUpperCase()).toContain("READY")
    expect(read.some((message) => message.type === "idle" && message.outcome === "interrupted")).toBe(true)
  }, 300_000)

  test.skipIf(!process.env.CHAOS_LIVE_MODEL_ALT)(
    "the alternate model changes a file on the sandbox with the patch tool",
    async () => {
      const alternate = await select(process.env.CHAOS_LIVE_MODEL_ALT)
      const opened = await current().stack.session({
        models: LiveModel.access(alternate),
        hand: current().hand,
        start: { model: { endpointId: alternate.providerId, modelId: alternate.modelId }, instructions },
      })
      const name = `patched-${crypto.randomUUID().slice(0, 6)}.txt`
      const before = `before-${crypto.randomUUID().slice(0, 6)}`
      const after = `after-${crypto.randomUUID().slice(0, 6)}`
      await current().hand.instance.observe([
        "sh",
        "-c",
        `mkdir -p ${opened.sessionId} && printf '%s\\n' ${before} > ${opened.sessionId}/${name}`,
      ])
      const read = await ask(
        opened,
        `Use the patch tool to change the line ${before} to ${after} in ${name}. Do not use the shell. Reply DONE.`,
      )
      expect((await current().hand.instance.observe(["cat", `${opened.sessionId}/${name}`])).stdout.trim()).toBe(after)
      expect(SessionDriver.toolNames(read)).toContain("patch")
    },
    300_000,
  )

  test.skipIf(!process.env.CHAOS_LIVE_MODEL_ALT)(
    "switching between two small models in one session changes the model that answers",
    async () => {
      const selected = current().selected
      const alternate = await select(process.env.CHAOS_LIVE_MODEL_ALT)
      const endpoints = [...LiveModel.access(selected).endpoints, ...LiveModel.access(alternate).endpoints]
      const merged: Models.Access = {
        endpoints: [...Map.groupBy(endpoints, (endpoint) => endpoint.id).values()].flatMap((group) => {
          const first = group[0]
          return first ? [{ ...first, models: group.flatMap((endpoint) => endpoint.models) }] : []
        }),
      }
      const opened = await current().stack.session({
        models: merged,
        start: { model: { endpointId: selected.providerId, modelId: selected.modelId }, instructions },
      })
      await ask(opened, "Reply with ONE.")
      const model = { endpointId: alternate.providerId, modelId: alternate.modelId }
      expect((await opened.start({ model, instructions })).status).toBe(200)
      const models = (await ask(opened, "Reply with TWO.")).flatMap((message) =>
        message.type === "assistant" ? [message.model.id] : [],
      )
      expect(models.at(-1)).toBe(alternate.modelId)
      expect(models).toContain(selected.modelId)
    },
    300_000,
  )
})

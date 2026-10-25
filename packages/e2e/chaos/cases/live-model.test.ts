import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import type { Models } from "@ren/schema/models"
import { Result } from "effect"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { LiveModel } from "../lib/provider/live.js"
import { RealStack } from "../lib/real-stack.js"
import { Wait } from "../lib/wait.js"

const select = async (selection: string | undefined) => {
  const selected = await LiveModel.select(selection)
  if (Result.isFailure(selected)) throw new Error(selected.failure)
  return selected.success
}

describe.skipIf(Platform.wrangler !== undefined || Platform.docker !== undefined || Platform.live !== undefined)(
  "a live model on the real Ren server, a Wrangler cell and a Docker sandbox",
  () => {
    const lane: { stack?: RealStack.Instance; live?: Awaited<ReturnType<typeof LiveModel.named>> } = {}

    const current = () => {
      if (!lane.stack || !lane.live) throw new Error("the stack did not start")
      return { stack: lane.stack, sandbox: lane.stack.sandbox("live"), live: lane.live }
    }

    beforeAll(async () => {
      lane.live = await LiveModel.named(await select(process.env.CHAOS_LIVE_MODEL))
      // oxlint-disable-next-line ren/no-comments -- Ren's inference URL comes from this grant (HR16), so brains read the live model list; no test providers in the cell's OpenCode config shadow it.
      lane.stack = await RealStack.start({
        environments: [{ label: "live" }],
        models: lane.live.access,
        cellVars: { OPENCODE_CONFIG: "{}" },
      })
    }, 600_000)

    afterAll(() => lane.stack?.dispose(), 120_000)

    const session = () =>
      current().stack.session({
        models: current().live.access,
        start: { model: current().live.model },
      })

    const ask = (opened: RealStack.Driver, text: string) => opened.ask(text)

    const lastAnswer = (read: Awaited<ReturnType<typeof ask>>) => SessionDriver.assistantTexts(read).at(-1) ?? ""

    test("a follow-up turn uses context from the previous turn", async () => {
      const opened = await session()
      const word = `kiwi${crypto.randomUUID().slice(0, 4)}`
      await ask(opened, `Remember the code word ${word}. Reply with OK only.`)
      const read = await ask(opened, "What was the code word? Reply with the word only.")
      expect(lastAnswer(read).toLowerCase()).toContain(word.toLowerCase())
    }, 300_000)

    test("the model creates, reads and edits a file, and the file on the environment proves it", async () => {
      const opened = await session()
      const name = `live-${crypto.randomUUID().slice(0, 6)}.txt`
      const first = `alpha-${crypto.randomUUID().slice(0, 6)}`
      const second = `omega-${crypto.randomUUID().slice(0, 6)}`
      const read = await ask(
        opened,
        `Use your tools: create ${name} containing exactly ${first}, read it back, then replace ${first} with ${second}. Reply DONE.`,
      )
      expect((await current().sandbox.container.observe(["cat", `${opened.sessionId}/${name}`])).stdout.trim()).toBe(
        second,
      )
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
      // oxlint-disable-next-line ren/no-comments -- No word limit here: the turn must still stream when the interrupt arrives.
      const opened = await current().stack.session({
        models: current().live.access,
        start: { model: current().live.model },
      })
      const events = SessionDriver.subscribe(opened.opencode)
      await events.connected
      await opened.send("Write a 2000-word story about a river, in plain prose. Use no tools.")
      await Wait.until("the model to start streaming", 60_000, async () =>
        events.events.some((event) => event.type === "session.text.delta") ? true : undefined,
      )
      events.close()
      expect((await opened.opencode.session.interrupt({ sessionID: opened.sessionId })).interrupted).toBe(true)
      const read = await ask(opened, "Reply with the word READY only.")
      expect(lastAnswer(read).toUpperCase()).toContain("READY")
      expect(read.some((message) => message.type === "idle" && message.outcome === "interrupted")).toBe(true)
    }, 300_000)

    test.skipIf(!process.env.CHAOS_LIVE_MODEL_ALT)(
      "the alternate model changes a file on the sandbox with the patch tool",
      async () => {
        const alternate = await LiveModel.named(await select(process.env.CHAOS_LIVE_MODEL_ALT))
        const opened = await current().stack.session({ models: alternate.access, start: { model: alternate.model } })
        const name = `patched-${crypto.randomUUID().slice(0, 6)}.txt`
        const before = `before-${crypto.randomUUID().slice(0, 6)}`
        const after = `after-${crypto.randomUUID().slice(0, 6)}`
        await current().sandbox.container.observe([
          "sh",
          "-c",
          `mkdir -p ${opened.sessionId} && printf '%s\\n' ${before} > ${opened.sessionId}/${name}`,
        ])
        const read = await ask(
          opened,
          `Use the patch tool to change the line ${before} to ${after} in ${name}. Do not use the shell. Reply DONE.`,
        )
        expect((await current().sandbox.container.observe(["cat", `${opened.sessionId}/${name}`])).stdout.trim()).toBe(
          after,
        )
        expect(SessionDriver.toolNames(read)).toContain("patch")
      },
      300_000,
    )

    test.skipIf(!process.env.CHAOS_LIVE_MODEL_ALT)(
      "switching between two small models in one session changes the model that answers",
      async () => {
        const selected = current().live
        const alternate = await LiveModel.named(await select(process.env.CHAOS_LIVE_MODEL_ALT))
        const endpoints = [...selected.access.endpoints, ...alternate.access.endpoints]
        const merged: Models.Access = {
          endpoints: [...Map.groupBy(endpoints, (endpoint) => endpoint.id).values()].flatMap((group) => {
            const first = group[0]
            return first ? [{ ...first, models: group.flatMap((endpoint) => endpoint.models) }] : []
          }),
        }
        const opened = await current().stack.session({
          environment: false,
          models: merged,
          start: { model: selected.model },
        })
        await ask(opened, "Reply with ONE.")
        await opened.start({ model: alternate.model })
        const models = (await ask(opened, "Reply with TWO.")).flatMap((message) =>
          message.type === "assistant" ? [message.model.id] : [],
        )
        expect(models.at(-1)).toBe(alternate.model.modelId)
        expect(models).toContain(selected.model.modelId)
      },
      300_000,
    )
  },
)

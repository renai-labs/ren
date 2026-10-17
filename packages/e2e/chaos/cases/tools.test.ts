import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

describe.skipIf(Platform.wrangler !== undefined)("tools through the cell's dispatcher", () => {
  const lane: { stack?: Stack.Instance; hand?: Stack.Hand } = {}

  const current = () => {
    if (!lane.stack || !lane.hand) throw new Error("the stack did not start")
    return { stack: lane.stack, hand: lane.hand }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.hand = await lane.stack.hand("tools")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const attached = (options: { readonly interactive?: boolean } = {}) =>
    current().stack.session({ hand: current().hand, start: options })

  const operationsSince = (from: number) =>
    current()
      .hand.proxy.seen.slice(from)
      .map((entry) => entry.operation)

  const read = async (sessionId: string, name: string) =>
    (await current().hand.instance.observe(["cat", `${sessionId}/${name}`])).stdout

  test("a chat-only turn on an attached session sends no executor request", async () => {
    const session = await attached()
    const from = current().hand.proxy.seen.length
    const turn = await session.turn([ModelProvider.text("just chatting")])
    await turn.script.called(1)
    await session.settled()
    expect(operationsSince(from)).toEqual([])
  })

  test("patch, which OpenCode offers to GPT models in place of edit and write, adds, updates and deletes files on the hand", async () => {
    const stack = current().stack
    const endpoint = stack.access().endpoints[0]
    if (!endpoint) throw new Error("the access has no endpoint")
    const gpt = { id: "gpt-5-chaos", name: "GPT Chaos", limit: { context: 100_000, output: 4000 } }
    const session = await stack.session({
      models: { endpoints: [{ ...endpoint, models: [...endpoint.models, gpt] }] },
      hand: current().hand,
      start: { model: { endpointId: endpoint.id, modelId: gpt.id } },
    })
    const stem = crypto.randomUUID().slice(0, 8)
    await current().hand.instance.observe([
      "sh",
      "-c",
      `mkdir -p ${session.sessionId} && cd ${session.sessionId} && printf 'one\\ntwo\\n' > update-${stem}.txt; printf 'x\\n' > delete-${stem}.txt`,
    ])
    const patchText = [
      "*** Begin Patch",
      `*** Add File: add-${stem}.txt`,
      "+added",
      `*** Update File: update-${stem}.txt`,
      "@@",
      " one",
      "-two",
      "+three",
      `*** Delete File: delete-${stem}.txt`,
      "*** End Patch",
    ].join("\n")
    const turn = await session.turn([ModelProvider.tool("patch", { patchText }), ModelProvider.text("done")])
    const call = await turn.script.called(2, 60_000)
    expect(call.tools).not.toContain("edit")
    expect(call.toolResults).toContain("Success")
    expect(await read(session.sessionId, `add-${stem}.txt`)).toBe("added\n")
    expect(await read(session.sessionId, `update-${stem}.txt`)).toBe("one\nthree\n")
    expect(
      (await current().hand.instance.observe(["test", "-e", `${session.sessionId}/delete-${stem}.txt`])).exitCode,
    ).not.toBe(0)
  })

  test("question is answered through the client and never touches the hand", async () => {
    const session = await attached({ interactive: true })
    const from = current().hand.proxy.seen.length
    const turn = await session.turn([
      ModelProvider.tool("question", {
        questions: [{ question: "Which colour?", header: "Colour", options: [{ label: "Teal", description: "teal" }] }],
      }),
      ModelProvider.text("thanks"),
    ])
    const form = await SessionDriver.firstForm(session.opencode, session.id)
    await session.opencode.session.form.reply({
      sessionID: session.id,
      formID: form.id,
      answer: { [form.fields[0].key]: "Teal" },
    })
    expect((await turn.script.called(2, 60_000)).toolResults).toContain("Teal")
    expect(operationsSince(from)).toEqual([])
  })

  test("brain and external tools run without executor traffic", async () => {
    const session = await attached()
    const inputs: Readonly<Record<string, unknown>> = {
      skill: { id: "missing-skill" },
      webfetch: { url: `${current().stack.providerProxy.url}/not-found`, format: "text" },
      list_mcp_resources: {},
      read_mcp_resource: { server: "missing", uri: "missing://resource" },
    }
    const probe = await session.turn([ModelProvider.text("which tools")])
    const offered = (await probe.script.called(1)).tools.filter((tool) => inputs[tool] !== undefined)
    await session.settled()
    expect(offered.length).toBeGreaterThan(0)
    const from = current().hand.proxy.seen.length
    const turn = await session.turn([
      ...offered.map((tool) => ModelProvider.tool(tool, inputs[tool])),
      ModelProvider.text("done"),
    ])
    await turn.script.called(offered.length + 1, 60_000)
    await session.settled()
    expect(operationsSince(from)).toEqual([])
  })

  test.skipIf(Platform.docker !== undefined)(
    "a paused container ends a running shell call in its time limit, and stops the command once it runs again",
    async () => {
      const stack = current().stack
      const hand = await stack.dockerHand("paused")
      const session = await stack.session({ hand })
      const marker = `paused-${crypto.randomUUID().slice(0, 8)}`
      const turn = await session.turn([
        ModelProvider.tool("shell", { command: `echo started; sleep 300; echo ${marker}` }),
        ModelProvider.text("ok"),
      ])
      await Wait.until("the command to start in the container", 60_000, async () =>
        (await hand.instance.observe(["pgrep", "-f", marker])).exitCode === 0 ? true : undefined,
      )
      await hand.instance.freeze()
      const started = Date.now()
      const result = (await turn.script.called(2, 120_000)).toolResults
      expect(Date.now() - started).toBeLessThan(75_000)
      expect(result).toContain("did not finish")
      await hand.instance.thaw()
      await Wait.until("the executor to stop the command", 90_000, async () =>
        (await hand.instance.observe(["pgrep", "-f", marker])).exitCode !== 0 ? true : undefined,
      )
      await session.settled()
    },
    300_000,
  )

  test.skipIf(Platform.docker !== undefined)(
    "a replaced container runs new commands in its empty workspace, and old process IDs are unknown there",
    async () => {
      const stack = current().stack
      const hand = await stack.dockerHand("replaced")
      const session = await stack.session({ hand })
      const shell = async (command: string) => {
        const turn = await session.turn([ModelProvider.tool("shell", { command }), ModelProvider.text("ok")])
        const result = (await turn.script.called(2, 60_000)).toolResults
        await session.settled()
        return result
      }
      expect(await shell("echo kept > before.txt && ls")).toContain("before.txt")
      const driver = await hand.driver()
      const old = await driver.ok(driver.client["process.spawn"]({ command: "sleep", arguments: ["120"] }))
      await hand.instance.replace()
      hand.retarget()
      await hand.publish(hand.generation() + 1)
      expect(await shell("ls -a; echo listed")).not.toContain("before.txt")
      expect((await driver.output(old.id, 10_000)).error).toBe("ProcessNotFoundError")
      await driver.dispose()
    },
    300_000,
  )
})

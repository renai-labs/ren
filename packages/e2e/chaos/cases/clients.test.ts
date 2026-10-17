import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { TestToken } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionDriver } from "../lib/drivers/session.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"
import { Wait } from "../lib/wait.js"

const settled = (outcome: Promise<unknown>) =>
  outcome.then(
    () => "ok" as const,
    () => "failed" as const,
  )

describe.skipIf(Platform.wrangler !== undefined)("clients on the user link", () => {
  const lane: { stack?: Stack.Instance } = {}

  const stack = () => {
    if (!lane.stack) throw new Error("the stack did not start")
    return lane.stack
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const second = (session: SessionDriver.Driver) =>
    OpenCode.make({ baseUrl: stack().cellProxy.url, headers: { authorization: TestToken.basic(session.client) } })

  test("two clients prompt, queue and interrupt, and both read the same transcript", async () => {
    const session = await stack().session()
    const other = second(session)
    const first = stack().provider.script([ModelProvider.text("held", { hold: true })])
    const queued = stack().provider.script([ModelProvider.text("queued answer")])
    await session.opencode.session.prompt({ sessionID: session.id, text: `first ${first.marker}` })
    await first.called(1)
    const sent = await other.session.prompt({
      sessionID: session.id,
      text: `second ${queued.marker}`,
      delivery: "queue",
    })
    expect((await session.opencode.session.interrupt({ sessionID: session.id })).interrupted).toBe(true)
    await session.settled()
    const views = await Promise.all([session.messages(), SessionDriver.messages(other, session.id)])
    expect(views[0]).toEqual(views[1])
    const inbox = await other.session.inbox.list({ sessionID: session.id })
    expect(SessionDriver.occurrences(views[0], sent.id) + inbox.filter((item) => item.id === sent.id).length).toBe(1)
  })

  test("two clients submitting the same message ID create one user message and one turn", async () => {
    const session = await stack().session()
    const script = stack().provider.script([ModelProvider.text("once")])
    const id = Session.MessageID.create()
    const results = await Promise.all(
      [session.opencode, second(session)].map((client) =>
        settled(client.session.prompt({ sessionID: session.id, id, text: `same ${script.marker}` })),
      ),
    )
    expect(results).toContain("ok")
    expect(SessionDriver.occurrences(await session.settled(), id)).toBe(1)
    expect(script.calls).toHaveLength(1)
  })

  test("two clients answering one question resolve it once", async () => {
    const session = await stack().session({ start: { interactive: true } })
    const turn = await session.turn([
      ModelProvider.tool("question", {
        questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
      }),
      ModelProvider.text("answered"),
    ])
    const form = await SessionDriver.firstForm(session.opencode, session.id)
    const answer = { [form.fields[0].key]: "A" }
    const results = await Promise.all(
      [session.opencode, second(session)].map((client) =>
        settled(client.session.form.reply({ sessionID: session.id, formID: form.id, answer })),
      ),
    )
    expect(results).toContain("ok")
    await turn.script.called(2, 60_000)
    await session.settled()
    expect(turn.script.calls).toHaveLength(2)
    expect(await session.opencode.session.form.list({ sessionID: session.id })).toEqual([])
  })

  test("a client cut off mid-turn resubscribes, reloads a snapshot and converges", async () => {
    const session = await stack().session()
    const original = SessionDriver.subscribe(session.opencode)
    await Wait.deadline("the subscriber to connect", 15_000, original.connected)
    const turn = await session.turn([ModelProvider.text("long answer", { hold: true })])
    await turn.script.called(1)
    expect(stack().cellProxy.cutAll()).toBeGreaterThan(0)
    expect(await Wait.deadline("the cut stream to end", 10_000, original.ended)).not.toBe("ended")
    const reconnected = SessionDriver.subscribe(session.opencode)
    await Wait.deadline("the subscriber to reconnect", 15_000, reconnected.connected)
    expect(reconnected.events[0]?.type).toBe("server.connected")
    expect(SessionDriver.occurrences(await session.messages(), turn.messageId)).toBe(1)
    turn.script.release()
    expect(SessionDriver.assistantTexts(await session.settled()).join("")).toBe("long answer")
    reconnected.close()
  })

  test("aborting an accepted prompt request does not cancel the turn", async () => {
    const session = await stack().session()
    const script = stack().provider.script([ModelProvider.text("independent of the request")])
    const held = stack().cellProxy.inject({ operation: `POST /api/session/${session.id}/prompt` }, { type: "hold" })
    const controller = new AbortController()
    const request = settled(
      session.opencode.session.prompt(
        { sessionID: session.id, text: `abort ${script.marker}` },
        { signal: controller.signal },
      ),
    )
    await Wait.deadline("the prompt to be accepted", 15_000, held.committed)
    controller.abort()
    expect(await request).toBe("failed")
    held.release()
    await script.called(1)
    expect(SessionDriver.assistantTexts(await session.settled()).join("")).toBe("independent of the request")
  })
})

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"

setDefaultTimeout(120_000)

const runtime = ManagedRuntime.make(
  Layer.effect(
    Shared.Service,
    Effect.acquireRelease(
      Effect.promise(() => Celld.make(Shared.vars())),
      (instance) => Effect.promise(instance.dispose),
    ),
  ),
)
let celld: Celld.Instance
beforeAll(async () => {
  celld = await runtime.runPromise(Shared.Service)
}, 120_000)
afterAll(() => runtime.dispose())

const stub = Shared.stub()

const restart = async () => {
  await celld.kill()
  await celld.start()
}

const started = async () => {
  const opened = await TestCell.make(celld.url)
  await opened.start()
  return {
    ...opened,
    ended: () => opened.until((state) => Bun.deepEquals(state, TestCell.closed), 60_000),
    outcome: async () => (await opened.opencode.session.get({ sessionID: opened.id })).outcome,
    answers: async () =>
      (await opened.messages()).flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      ),
  }
}

const hour = 60 * 60 * 1000
const managed = (value: string, expiresAtMs: number) => Shared.apiKey(value, expiresAtMs)

const configure = async (opened: Awaited<ReturnType<typeof started>>, apiKeys: Parameters<typeof Shared.access>[0]) => {
  const response = await opened.models(Shared.access(apiKeys))
  if (response.status !== 204) throw new Error(`models answered ${response.status}: ${await response.text()}`)
}

const brainStart = async (opened: Awaited<ReturnType<typeof started>>) => {
  const response = await opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode" })
  if (response.status !== 200) throw new Error(`start answered ${response.status}: ${await response.text()}`)
}

const users = (call: StubModel.Call) =>
  call.body.messages.filter((message) => message.role === "user").map((message) => message.content)

describe("crash recovery", () => {
  test("killed after a prompt is queued behind a running turn: both prompts are answered with no client request", async () => {
    const opened = await started()
    const first = stub.script({ hold: true, reply: "cut off" })
    const second = stub.script({ reply: "after the crash" })
    await opened.prompt(`first ${first.marker}`)
    await first.called()
    await opened.prompt(`second ${second.marker}`, { delivery: "queue" })
    await restart()
    expect(users(await second.called())).toEqual([
      `first ${first.marker}`,
      StubModel.restarted,
      `second ${second.marker}`,
    ])
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect((await opened.messages()).filter((message) => message.type === "user")).toHaveLength(2)
    expect((await opened.answers()).at(-1)).toBe("after the crash")
    expect([first.calls.length, second.calls.length]).toEqual([1, 1])
    first.release()
  })

  test("killed mid-stream, and again once the alarm reopens OpenCode: the turn resumes with the restart message and finishes with no client request", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    await restart()
    await opened.until((state) => state.isOpen, 60_000)
    await celld.kill()
    const calls = script.calls.length
    script.set({ reply: "resumed" })
    await celld.start()
    expect(calls).toBe(1)
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect(TestCell.kinds(await opened.messages()).slice(-3)).toEqual(["synthetic", "assistant", "idle:succeeded"])
    expect((await opened.answers()).at(-1)).toBe("resumed")
    expect(script.calls).toHaveLength(2)
  })

  test("killed with nothing running: the cell restarts with no alarm and makes no model call", async () => {
    const opened = await started()
    await opened.prompt(`once ${stub.script({ reply: "done" }).marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    await opened.ended()
    const calls = stub.calls.length
    await restart()
    expect(await opened.state()).toEqual(TestCell.closed)
    expect(stub.calls).toHaveLength(calls)
  })

  test("killed right after send is accepted: the turn runs with no client request", async () => {
    const opened = await started()
    await configure(opened, undefined)
    expect((await opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode" })).status).toBe(200)
    const script = stub.script({ hold: true, reply: "cut off" })
    const messageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`
    const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
      messageId,
      prompt: { text: `send ${script.marker}` },
      sender: { userId: "user_1" },
    })
    await celld.kill()
    expect(sent.status).toBe(200)
    const before = script.calls.length
    script.set({ reply: "after the crash" })
    await celld.start()
    await script.called(before + 1)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect((await opened.messages()).filter((message) => message.id === messageId)).toHaveLength(1)
    expect((await opened.answers()).at(-1)).toBe("after the crash")
    script.release()
  })

  test("killed after a newer key is configured during a turn: the resumed model call carries the newer key", async () => {
    const opened = await started()
    await configure(opened, { stub: managed("sk-older", Date.now() + hour) })
    await brainStart(opened)
    const script = stub.script({ hold: true, reply: "cut off" })
    const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
      messageId: `msg_${crypto.randomUUID().replaceAll("-", "")}`,
      prompt: { text: `send ${script.marker}` },
      sender: { userId: "user_1" },
    })
    expect(sent.status).toBe(200)
    await script.called()
    await configure(opened, { stub: managed("sk-newer", Date.now() + 2 * hour) })
    script.set({ reply: "resumed" })
    await restart()
    expect(await script.called(2)).toMatchObject({ text: StubModel.restarted, authorization: "Bearer sk-newer" })
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
  })
})

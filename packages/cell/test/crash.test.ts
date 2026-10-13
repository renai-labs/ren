import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"

setDefaultTimeout(120_000)

const celld = await Celld.make(Shared.vars())
afterAll(celld.dispose)

const stub = Shared.stub()
const interval = 1000
const question = {
  questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
}

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

  test("killed mid-stream: the turn resumes with the restart message and finishes with no client request", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    script.set({ reply: "resumed" })
    await restart()
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect(TestCell.kinds(await opened.messages()).slice(-3)).toEqual(["synthetic", "assistant", "idle:succeeded"])
    expect((await opened.answers()).at(-1)).toBe("resumed")
    expect(script.calls).toHaveLength(2)
  })

  test("killed during a wait that outlived its budget: the turn finishes with no client request", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    const first = (await opened.until((state) => state.waiting !== null)).waiting
    await opened.until((state) => state.waiting !== null && state.waiting !== first)
    script.set({ reply: "resumed" })
    await restart()
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect(script.calls).toHaveLength(2)
  })

  test("killed twice in a row, the second time during the resumed turn: the turn still finishes", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    await restart()
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    script.set({ reply: "resumed twice" })
    await restart()
    expect((await script.called(3)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect((await opened.answers()).at(-1)).toBe("resumed twice")
    expect(script.calls).toHaveLength(3)
  })

  test("killed while reconcile opens OpenCode: the next alarm resumes the turn", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    await restart()
    await opened.until((state) => state.harnessOpen, 60_000)
    await celld.kill()
    const calls = script.calls.length
    script.set({ reply: "resumed" })
    await celld.start()
    expect(calls).toBe(1)
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    expect(script.calls).toHaveLength(2)
  })

  test("killed as the idle reconcile that closes the cell falls due: the cell ends closed and makes no model call", async () => {
    const opened = await started()
    const script = stub.script({ reply: "done" })
    await opened.prompt(`once ${script.marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    const due = (await opened.until((state) => state.harnessOpen && state.alarmAt !== null)).alarmAt ?? 0
    await Bun.sleep(Math.max(0, due - Date.now()))
    await celld.kill()
    const calls = stub.calls.length
    await celld.start()
    expect(await opened.ended()).toEqual(TestCell.closed)
    await Bun.sleep(2 * interval)
    expect(await opened.state()).toEqual(TestCell.closed)
    expect(stub.calls).toHaveLength(calls)
    expect(TestCell.kinds(await opened.messages())).toEqual(["user", "assistant", "idle:succeeded"])
  })

  test("killed just after a turn ends: no second turn runs", async () => {
    const opened = await started()
    const script = stub.script({ reply: "done" })
    await opened.prompt(`once ${script.marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    await restart()
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(script.calls).toHaveLength(1)
    expect(TestCell.kinds(await opened.messages())).toEqual(["user", "assistant", "idle:succeeded"])
  })

  test("killed while a question waits: the turn resumes and the cell ends idle and closed", async () => {
    const opened = await started()
    const script = stub.script({ tool: { name: "question", input: question } })
    await opened.prompt(`ask ${script.marker}`)
    const pending = async (): Promise<void> =>
      (await opened.opencode.session.form.list({ sessionID: opened.id })).length > 0 ? undefined : pending()
    await pending()
    script.set({ reply: "resumed without an answer" })
    await restart()
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("succeeded")
    const messages = await opened.messages()
    expect(TestCell.kinds(messages)).toEqual(["user", "assistant", "synthetic", "assistant", "idle:succeeded"])
    expect(messages[1]).toMatchObject({ content: [{ type: "tool", name: "question", state: { status: "error" } }] })
  })

  test("killed with nothing running: the cell restarts with no alarm and makes no model call", async () => {
    const opened = await started()
    await opened.prompt(`once ${stub.script({ reply: "done" }).marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    await opened.ended()
    const calls = stub.calls.length
    await restart()
    await Bun.sleep(2 * interval)
    expect(await opened.state()).toEqual(TestCell.closed)
    expect(stub.calls).toHaveLength(calls)
  })

  test("killed mid-stream with the model rejecting the resumed call: the turn fails and the cell ends idle and closed", async () => {
    const opened = await started()
    const script = stub.script({ hold: true, reply: "cut off" })
    await opened.prompt(`hold ${script.marker}`)
    await script.called()
    script.set({ status: 400 })
    await restart()
    expect((await script.called(2)).text).toBe(StubModel.restarted)
    expect(await opened.ended()).toEqual(TestCell.closed)
    expect(await opened.outcome()).toBe("failed")
    expect(script.calls).toHaveLength(2)
  })
})

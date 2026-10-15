import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { Effect, Layer, ManagedRuntime, Schema } from "effect"
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
const interval = 1000

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
const key = (value: string) => Shared.apiKey(value)
const managed = (value: string, expiresAtMs: number) => Shared.apiKey(value, expiresAtMs)

const Stored = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      integrationID: Schema.String,
      value: Schema.Struct({ key: Schema.optional(Schema.String), access: Schema.optional(Schema.String) }),
    }),
  ),
})

const configure = async (opened: Awaited<ReturnType<typeof started>>, apiKeys: Parameters<typeof Shared.access>[0]) => {
  const response = await opened.models(Shared.access(apiKeys))
  if (response.status !== 204) throw new Error(`models answered ${response.status}: ${await response.text()}`)
}

const brainStart = async (opened: Awaited<ReturnType<typeof started>>, input: Record<string, unknown>) => {
  const response = await opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode", ...input })
  if (response.status !== 200) throw new Error(`start answered ${response.status}: ${await response.text()}`)
}

const stored = async (opened: Awaited<ReturnType<typeof started>>) => {
  const response = await fetch(`${celld.url}/api/credential`, { headers: { authorization: opened.server } })
  return Object.fromEntries(
    Schema.decodeUnknownSync(Stored)(await response.json()).data.map((credential) => [
      credential.integrationID,
      credential.value.key ?? credential.value.access,
    ]),
  )
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

  test("killed while reconcile opens OpenCode: the next alarm resumes the turn", async () => {
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
    expect(script.calls).toHaveLength(2)
  })

  test("killed as the idle reconcile that closes the cell falls due: the cell ends closed and makes no model call", async () => {
    const opened = await started()
    const script = stub.script({ reply: "done" })
    await opened.prompt(`once ${script.marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    const due = (await opened.until((state) => state.isOpen && state.nextReconcileAt !== null)).nextReconcileAt ?? 0
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

  test("killed during a second start: whatever it kept, a retried start leaves exactly the new state", async () => {
    const opened = await started()
    await configure(opened, undefined)
    const first = {
      sessionId: opened.id,
      harness: "opencode",
      title: "First",
      instructions: { team: "Ren", goal: "ship" },
    }
    expect((await opened.brain("/ren/sessions", first)).status).toBe(200)
    const instructions = Object.fromEntries(
      Array.from({ length: 3000 }, (_, index) => [`block-${index}`, `value ${index}`]),
    )
    const second = { sessionId: opened.id, harness: "opencode", title: "Second", agent: "plan", instructions }
    const inflight = opened.brain("/ren/sessions", second).then(
      (response) => response.status,
      () => "dropped",
    )
    await Bun.sleep(600)
    await celld.kill()
    expect(await inflight).toBe("dropped")
    await celld.start()
    const partial = await opened.opencode.session.instructions.entry.list({ sessionID: opened.id })
    expect(partial.map((entry) => entry.key)).toEqual(expect.arrayContaining(["team", "goal"]))
    expect(partial.filter((entry) => !(entry.key in instructions) && !(entry.key in first.instructions))).toEqual([])
    expect((await opened.brain("/ren/sessions", second)).status).toBe(200)
    const entries = await opened.opencode.session.instructions.entry.list({ sessionID: opened.id })
    expect(Object.fromEntries(entries.map((entry) => [entry.key, entry.value]))).toEqual(instructions)
    expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({
      title: "Second",
      agent: "plan",
    })
    expect(await opened.ended()).toEqual(TestCell.closed)
  })

  test("killed after a newer key is configured during a turn: the resumed model call carries the newer key", async () => {
    const opened = await started()
    await configure(opened, { stub: managed("sk-older", Date.now() + hour) })
    await brainStart(opened, {})
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

  test("killed after a configuration change: the reopened host holds exactly the stored credentials", async () => {
    const opened = await started()
    await configure(opened, { stub: key("sk-old"), anthropic: key("sk-ant") })
    await brainStart(opened, {})
    expect(await stored(opened)).toEqual({ stub: "sk-old", anthropic: "sk-ant" })
    await configure(opened, { stub: key("sk-new") })
    await restart()
    expect(await stored(opened)).toEqual({ stub: "sk-new" })
    expect(await opened.ended()).toEqual(TestCell.closed)
  })
})

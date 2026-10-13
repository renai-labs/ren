import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import path from "path"
import { OpenCode } from "@opencode/client"
import { Celld } from "./lib/celld.js"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"
import { TestToken } from "./lib/token.js"

const celld = await Celld.make(Shared.vars(), "test/worker/worker.ts")
afterAll(celld.dispose)

const stub = Shared.stub()
const restarted = StubModel.restarted
const question = {
  questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
}

const until = async (
  iterator: AsyncIterator<{ readonly type: string }>,
  type: string,
): Promise<{ readonly type: string }> => {
  const next = await iterator.next()
  if (next.done) throw new Error(`the event stream ended before ${type}`)
  return next.value.type === type ? next.value : until(iterator, type)
}

const session = async (parentID?: string) => {
  const root = `ses_${crypto.randomUUID().replaceAll("-", "")}`
  const client = OpenCode.make({ baseUrl: celld.url, headers: { authorization: TestToken.basic(root) } })
  await client.session.create({ id: root })
  const child =
    parentID === undefined ? undefined : await client.session.create({ id: `${root}_child`, parentID: root })
  const id = child?.id ?? root
  return {
    id,
    client,
    prompt: (
      text: string,
      input: { readonly id?: string; readonly delivery?: "steer" | "queue"; readonly resume?: boolean } = {},
    ) => client.session.prompt({ sessionID: id, text, ...input }),
    wait: () => client.session.wait({ sessionID: id }),
    info: () => client.session.get({ sessionID: id }),
    active: async () => Object.keys(await client.session.active()).includes(id),
    inbox: () => client.session.inbox.list({ sessionID: id }),
    messages: async () => (await client.message.list({ sessionID: id, order: "asc" })).data,
    next: async (type: string) => {
      const controller = new AbortController()
      const iterator = client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
      await iterator.next()
      return { received: until(iterator, type).finally(() => controller.abort()) }
    },
    close: () =>
      fetch(`${celld.url}/test/close`, { method: "POST", headers: { authorization: TestToken.basic(root) } }),
  }
}

type Session = Awaited<ReturnType<typeof session>>

const kinds = (messages: ReadonlyArray<{ readonly type: string; readonly outcome?: string }>) =>
  messages.map((message) => (message.type === "idle" ? `idle:${message.outcome}` : message.type))

const mentions = (marker: string) => (call: { readonly body: { readonly messages: ReadonlyArray<unknown> } }) =>
  JSON.stringify(call.body.messages).includes(marker)

describe("OpenCode in a cell", () => {
  describe("the host", () => {
    test("serves OpenCode's HTTP API and reports the installed OpenCode version", async () => {
      const installed = await Bun.file(path.join(import.meta.dir, "../node_modules/@opencode/core/package.json")).json()
      expect(await (await session()).client.server.info()).toMatchObject({ version: installed.version })
    })
  })

  describe("idle marker", () => {
    test("a new session with no turns has no idle marker yet", async () => {
      const opened = await session()
      expect((await opened.info()).time.idle).toBeUndefined()
      expect(kinds(await opened.messages())).toEqual([])
    })

    test("a running turn has no idle marker", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      expect((await opened.info()).time.idle).toBeUndefined()
      expect(kinds(await opened.messages())).not.toContain("idle:succeeded")
      script.release()
      await opened.wait()
    })

    test("a turn that succeeds ends in an idle marker with the outcome succeeded", async () => {
      const opened = await session()
      await opened.prompt(`hello ${stub.script().marker}`)
      await opened.wait()
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "idle:succeeded"])
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })

    test("a model error that is not retried ends the turn in an idle marker with the outcome failed", async () => {
      const failures = await Promise.all(
        [{ status: 400 }, { malformed: true }].map(async (behaviour) => {
          const opened = await session()
          await opened.prompt(`fail ${stub.script(behaviour).marker}`)
          await opened.wait()
          return { last: kinds(await opened.messages()).at(-1), outcome: (await opened.info()).outcome }
        }),
      )
      expect(failures).toEqual([
        { last: "idle:failed", outcome: "failed" },
        { last: "idle:failed", outcome: "failed" },
      ])
    })

    test("a 500 from the model is retried in the same turn", async () => {
      const opened = await session()
      const script = stub.script({ status: 500 })
      await opened.prompt(`retry ${script.marker}`)
      await script.called(2)
      expect(await opened.active()).toBe(true)
      await opened.client.session.interrupt({ sessionID: opened.id })
      await opened.wait()
    }, 15_000)

    test("a stream cut mid-way is continued in the same turn and ends succeeded", async () => {
      const opened = await session()
      const script = stub.script({ cut: true })
      await opened.prompt(`cut ${script.marker}`)
      await opened.wait()
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "synthetic", "assistant", "idle:succeeded"])
    })

    test("an interrupted turn ends in an idle marker with the outcome interrupted", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`interrupt ${script.marker}`)
      await script.called()
      await opened.client.session.interrupt({ sessionID: opened.id })
      await opened.wait()
      script.release()
      expect(kinds(await opened.messages()).at(-1)).toBe("idle:interrupted")
    })
  })

  describe("reads", () => {
    test("session.active lists a running session and drops it once the turn ends", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      expect(await opened.active()).toBe(true)
      script.release()
      await opened.wait()
      expect(await opened.active()).toBe(false)
    })

    test("the inbox lists a prompt queued behind a running turn, with its id and delivery", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      await opened.prompt(`next ${stub.script().marker}`, { id: "msg_queued", delivery: "queue" })
      expect(await opened.inbox()).toMatchObject([{ id: "msg_queued", type: "user", delivery: "queue" }])
      script.release()
      await opened.wait()
    })

    test("a queued prompt leaves the inbox only once its turn runs", async () => {
      const opened = await session()
      const first = stub.script({ hold: true })
      const second = stub.script({ hold: true })
      await opened.prompt(`first ${first.marker}`)
      await first.called()
      await opened.prompt(`second ${second.marker}`, { delivery: "queue" })
      first.release()
      await second.called()
      expect({ inbox: await opened.inbox(), active: await opened.active() }).toEqual({ inbox: [], active: true })
      second.release()
      await opened.wait()
    })

    test("a child session shows in the reads like a root session", async () => {
      const child = await session("root")
      const script = stub.script({ hold: true })
      await child.prompt(`child ${script.marker}`)
      await script.called()
      expect(await child.active()).toBe(true)
      script.release()
      await child.wait()
      expect(kinds(await child.messages()).at(-1)).toBe("idle:succeeded")
    })
  })

  describe("re-sending", () => {
    test("re-sending a queued prompt by its id returns the queued item and admits nothing twice", async () => {
      const opened = await session()
      const first = stub.script({ hold: true })
      const second = stub.script()
      await opened.prompt(`first ${first.marker}`)
      await first.called()
      const queued = await opened.prompt(`second ${second.marker}`, { id: "msg_resent", delivery: "queue" })
      expect(
        await opened.prompt(`second ${second.marker}`, { id: "msg_resent", delivery: "queue", resume: true }),
      ).toEqual(queued)
      expect(await opened.inbox()).toHaveLength(1)
      first.release()
      await second.called()
      await opened.wait()
      expect((await opened.messages()).filter((message) => message.id === "msg_resent")).toHaveLength(1)
      expect(second.calls).toHaveLength(1)
    })

    test("re-sending a prompt that already ran runs no second turn", async () => {
      const opened = await session()
      const script = stub.script()
      await opened.prompt(`once ${script.marker}`, { id: "msg_once" })
      await opened.wait()
      await opened.prompt(`once ${script.marker}`, { id: "msg_once", resume: true })
      await opened.wait()
      expect((await opened.messages()).filter((message) => message.id === "msg_once")).toHaveLength(1)
      expect(script.calls).toHaveLength(1)
    })
  })

  describe("waiting", () => {
    test("a wait returns when the turn ends", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const state = { settled: false }
      const waiting = opened.wait().then(() => {
        state.settled = true
      })
      await opened.info()
      expect(state.settled).toBe(false)
      script.release()
      await waiting
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })

    test("cancelling a wait leaves the turn running to the end", async () => {
      const opened = await session()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const controller = new AbortController()
      const waiting = opened.client.session.wait({ sessionID: opened.id }, { signal: controller.signal })
      controller.abort()
      await expect(waiting).rejects.toThrow()
      expect(await opened.active()).toBe(true)
      script.release()
      await opened.wait()
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })
  })

  describe("new sessions", () => {
    test("the first prompt of a new session makes one title call besides the turn", async () => {
      const opened = await session()
      const script = stub.script()
      await opened.prompt(`first ${script.marker}`)
      await opened.wait()
      await stub.waitFor((call) => call.kind === "title" && call.marker === script.marker)
      expect(
        stub.calls
          .filter((call) => call.marker === script.marker)
          .map((call) => call.kind)
          .toSorted(),
      ).toEqual(["title", "turn"])
    })

    test("later prompts make no title call", async () => {
      const opened = await session()
      const first = stub.script()
      await opened.prompt(`first ${first.marker}`)
      await opened.wait()
      await stub.waitFor((call) => call.kind === "title" && call.marker === first.marker)
      const second = stub.script()
      await opened.prompt(`second ${second.marker}`)
      await opened.wait()
      expect(stub.calls.filter((call) => call.marker === second.marker).map((call) => call.kind)).toEqual(["turn"])
    })
  })

  describe("a pending question", () => {
    const ask = async () => {
      const opened = await session()
      const script = stub.script({ tool: { name: "question", input: question } })
      const created = await opened.next("form.created")
      await opened.prompt(`ask ${script.marker}`)
      await created.received
      return { opened, script }
    }

    test("a session waiting on a question counts as active", async () => {
      const opened = (await ask()).opened
      expect(await opened.client.session.form.list({ sessionID: opened.id })).toMatchObject([{ title: "Questions" }])
      expect(await opened.active()).toBe(true)
      await opened.client.session.interrupt({ sessionID: opened.id })
      await opened.wait()
    })

    test("closing the host drops the question: its tool call fails and the turn resumes without an answer", async () => {
      const asked = await ask()
      const opened = asked.opened
      const script = asked.script
      expect(await opened.client.session.form.list({ sessionID: opened.id })).toHaveLength(1)
      script.set({ reply: "resumed without an answer" })
      expect((await opened.close()).status).toBe(204)
      expect(await opened.client.session.form.list({ sessionID: opened.id })).toEqual([])
      await stub.waitFor((call) => mentions(script.marker)(call) && call.text === restarted)
      await opened.wait()
      const messages = await opened.messages()
      expect(kinds(messages)).toEqual(["user", "assistant", "synthetic", "assistant", "idle:succeeded"])
      expect(messages[1]).toMatchObject({ content: [{ type: "tool", name: "question", state: { status: "error" } }] })
      expect(messages[2]).toMatchObject({ text: restarted })
    })
  })

  describe("parking a question", () => {
    const park = async () => {
      const opened = await session()
      const script = stub.script({ tool: { name: "question", input: question } })
      const created = await opened.next("form.created")
      await opened.prompt(`ask ${script.marker}`)
      await created.received
      await opened.client.session.interrupt({ sessionID: opened.id })
      await opened.wait()
      expect((await opened.close()).status).toBe(204)
      return { opened, script }
    }

    test("interrupting a session that waits on a question ends the turn interrupted, and the reopen does not resume it", async () => {
      const parked = await park()
      expect(await parked.opened.info()).toMatchObject({ outcome: "interrupted" })
      expect(await parked.opened.active()).toBe(false)
      expect(await parked.opened.client.session.form.list({ sessionID: parked.opened.id })).toEqual([])
      const messages = await parked.opened.messages()
      expect(kinds(messages)).toEqual(["user", "assistant", "idle:interrupted"])
      expect(messages[1]).toMatchObject({
        content: [{ type: "tool", name: "question", state: { status: "error", input: question } }],
      })
    })

    test("an answer sent as a message after parking reaches the model after the question and its interrupted tool call", async () => {
      const parked = await park()
      const answer = stub.script({ reply: "Going with A" })
      await parked.opened.prompt(`A ${answer.marker}`)
      await parked.opened.wait()
      expect(
        answer.calls[0]?.body.messages.filter((message) => message.role !== "system").map((message) => message.role),
      ).toEqual(["user", "assistant", "tool", "user"])
      expect(await parked.opened.info()).toMatchObject({ outcome: "succeeded" })
      expect(parked.script.calls).toHaveLength(1)
    })
  })

  describe("after a crash", () => {
    const state: {
      finished: Session | undefined
      finishedMessages: Awaited<ReturnType<Session["messages"]>>
      cut: Session | undefined
      cutMarker: string
      queuedMarker: string
    } = { finished: undefined, finishedMessages: [], cut: undefined, cutMarker: "", queuedMarker: "" }

    beforeAll(async () => {
      const finished = await session()
      await finished.prompt(`done ${stub.script().marker}`)
      await finished.wait()
      await finished.client.session.instructions.entry.put({ sessionID: finished.id, key: "team", value: "Ren" })
      const cut = await session()
      const held = stub.script({ hold: true, reply: "cut off" })
      const queued = stub.script({ reply: "after the crash" })
      await cut.prompt(`hold ${held.marker}`)
      await held.called()
      await cut.prompt(`queued ${queued.marker}`, { id: "msg_queuedcrash", delivery: "queue" })
      Object.assign(state, {
        finished,
        finishedMessages: await finished.messages(),
        cut,
        cutMarker: held.marker,
        queuedMarker: queued.marker,
      })
      await celld.kill()
      await celld.start()
    }, 120_000)

    test("opening the host resumes a cut-off turn with the restart message and a new model call", async () => {
      const cut = state.cut
      if (!cut) throw new Error("the crash setup did not run")
      await cut.info()
      const resumed = await stub.waitFor(
        (call) => mentions(state.cutMarker)(call) && call.text !== `hold ${state.cutMarker}`,
      )
      expect(
        resumed.body.messages.filter((message) => message.role === "user").map((message) => message.content),
      ).toEqual([`hold ${state.cutMarker}`, restarted, `queued ${state.queuedMarker}`])
      await cut.wait()
      const resumedKinds = kinds(await cut.messages())
      expect(resumedKinds.slice(resumedKinds.indexOf("synthetic"))).toEqual([
        "synthetic",
        "user",
        "assistant",
        "idle:succeeded",
      ])
      expect(resumedKinds.slice(0, resumedKinds.indexOf("synthetic")).filter((kind) => kind !== "assistant")).toEqual([
        "user",
      ])
    })

    test("a prompt queued behind the cut-off turn is admitted once and answered in the resumed call", async () => {
      const cut = state.cut
      if (!cut) throw new Error("the crash setup did not run")
      await cut.wait()
      expect((await cut.messages()).filter((message) => message.id === "msg_queuedcrash")).toHaveLength(1)
      expect(await cut.inbox()).toEqual([])
      expect((await cut.messages()).at(-2)).toMatchObject({ content: [{ type: "text", text: "after the crash" }] })
    })

    test("sessions, messages and instruction entries survive, and a finished turn is not run again", async () => {
      const finished = state.finished
      if (!finished) throw new Error("the crash setup did not run")
      expect(await finished.messages()).toEqual(state.finishedMessages)
      expect(await finished.client.session.instructions.entry.list({ sessionID: finished.id })).toMatchObject([
        { key: "team", value: "Ren" },
      ])
      expect(await finished.active()).toBe(false)
    })
  })
})

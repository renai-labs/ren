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

const fresh = () => {
  const id = `ses_${crypto.randomUUID().replaceAll("-", "")}`
  return { id, client: OpenCode.make({ baseUrl: celld.url, headers: { authorization: TestToken.basic(id) } }) }
}

const session = async (parentID?: string) => {
  const made = fresh()
  const root = made.id
  const client = made.client
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
    test("re-sending a prompt id that already ran, even without resume, appends a second idle marker, so send looks the message up first", async () => {
      const opened = await session()
      const script = stub.script()
      await opened.prompt(`once ${script.marker}`, { id: "msg_twice" })
      await opened.wait()
      await expect(
        opened.client.session.message.get({ sessionID: opened.id, messageID: "msg_unknown" }),
      ).rejects.toMatchObject({ _tag: "MessageNotFoundError" })
      expect(await opened.client.session.message.get({ sessionID: opened.id, messageID: "msg_twice" })).toMatchObject({
        id: "msg_twice",
        type: "user",
      })
      await opened.prompt(`once ${script.marker}`, { id: "msg_twice" })
      await opened.wait()
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "idle:succeeded", "idle:succeeded"])
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

  describe("creating and updating a session", () => {
    test("a create with the Ren id, title, agent, model and location /workspace reports each back, and without a location the session is at /", async () => {
      const made = fresh()
      const created = await made.client.session.create({
        id: made.id,
        title: "First",
        agent: "build",
        model: { providerID: "stub", id: "stub-model" },
        location: { directory: "/workspace" },
      })
      expect(created).toMatchObject({
        id: made.id,
        title: "First",
        agent: "build",
        model: { providerID: "stub", id: "stub-model" },
        location: { directory: "/workspace" },
      })
      expect((await made.client.session.create({ id: `${made.id}_bare` })).location).toEqual({ directory: "/" })
    })

    test("a second create with the same id returns the existing row unchanged, ignoring a new title, agent and model", async () => {
      const made = fresh()
      const created = await made.client.session.create({ id: made.id, title: "First", agent: "build" })
      expect(
        await made.client.session.create({
          id: made.id,
          title: "Second",
          agent: "plan",
          model: { providerID: "stub", id: "stub-other" },
        }),
      ).toEqual(created)
      expect(await made.client.session.get({ sessionID: made.id })).toEqual(created)
    })

    test("a create with an unknown agent or model is accepted, and the first turn fails without a model call", async () => {
      const failed = await Promise.all(
        [{ agent: "nope" }, { model: { providerID: "stub", id: "nope" } }].map(async (input) => {
          const made = fresh()
          await made.client.session.create({ id: made.id, ...input })
          const script = stub.script()
          await made.client.session.prompt({ sessionID: made.id, text: `fail ${script.marker}` })
          await made.client.session.wait({ sessionID: made.id })
          const messages = (await made.client.message.list({ sessionID: made.id, order: "asc" })).data
          return { calls: script.calls.length, last: messages.at(-1) }
        }),
      )
      expect(failed).toMatchObject([
        {
          calls: 0,
          last: { type: "idle", outcome: "failed", error: { message: expect.stringContaining("Agent not found") } },
        },
        { calls: 0, last: { type: "idle", outcome: "failed", error: { type: "provider.no-route" } } },
      ])
    })

    test("agent.list and model.list name the agents and models a session can use, so a start can check them first", async () => {
      const opened = await session()
      const agents = (await opened.client.agent.list()).data.map((agent) => agent.id)
      const models = (await opened.client.model.list()).data.map((model) => `${model.providerID}/${model.modelID}`)
      expect(agents).toEqual(expect.arrayContaining(["build", "plan", "general", "explore"]))
      expect(agents).not.toContain("nope")
      expect(models).toEqual(expect.arrayContaining(["stub/stub-model", "stub/stub-other"]))
      expect(models).not.toContain("stub/nope")
    })

    test("updating the title, switching the agent and switching the model apply to the next turn's model call", async () => {
      const opened = await session()
      await opened.client.session.update({ sessionID: opened.id, title: "Renamed" })
      await opened.client.session.switchAgent({ sessionID: opened.id, agent: "plan" })
      await opened.client.session.switchModel({ sessionID: opened.id, model: { providerID: "stub", id: "stub-other" } })
      const script = stub.script()
      await opened.prompt(`next ${script.marker}`)
      await opened.wait()
      expect((await stub.waitFor((call) => call.kind === "turn" && mentions(script.marker)(call))).body.model).toBe(
        "stub-other",
      )
      expect((await opened.messages()).find((message) => message.type === "assistant")).toMatchObject({
        agent: "plan",
        model: { providerID: "stub", id: "stub-other" },
      })
      expect(await opened.info()).toMatchObject({ title: "Renamed", agent: "plan" })
    })

    test("switching to the plan agent leaves a synthetic reminder in the inbox that waits for the next prompt, without starting the session", async () => {
      const made = fresh()
      const sessionID = made.id
      const client = made.client
      await client.session.create({ id: sessionID, location: { directory: "/workspace" } })
      await client.session.switchAgent({ sessionID, agent: "plan" })
      const reminded = async (): Promise<unknown> => {
        const inbox = await client.session.inbox.list({ sessionID })
        if (inbox.length > 0) return inbox
        await Bun.sleep(25)
        return reminded()
      }
      expect(await reminded()).toMatchObject([
        { type: "synthetic", payload: { text: expect.stringContaining("Plan mode") } },
      ])
      expect(Object.keys(await client.session.active())).not.toContain(sessionID)
      const script = stub.script()
      await client.session.prompt({ sessionID, text: `plan ${script.marker}` })
      await client.session.wait({ sessionID })
      expect(JSON.stringify(script.calls[0]?.body.messages)).toContain("Plan mode")
      expect(await client.session.inbox.list({ sessionID })).toEqual([])
    })

    test("updating a session with its own title and permissions adds no message", async () => {
      const made = fresh()
      const permissions = [{ action: "question", resource: "*", effect: "deny" as const }]
      await made.client.session.create({ id: made.id, title: "Same", permissions })
      await made.client.session.update({ sessionID: made.id, title: "Same", permissions })
      await made.client.session.update({ sessionID: made.id, title: undefined, permissions })
      expect((await made.client.message.list({ sessionID: made.id })).data).toEqual([])
      expect(await made.client.session.get({ sessionID: made.id })).toMatchObject({ title: "Same", permissions })
    })

    test("a model given without a variant is the default variant: switching from another variant to it switches back", async () => {
      const made = fresh()
      await made.client.session.create({
        id: made.id,
        model: { providerID: "stub", id: "stub-model", variant: "high" },
      })
      await made.client.session.switchModel({ sessionID: made.id, model: { providerID: "stub", id: "stub-model" } })
      expect((await made.client.session.get({ sessionID: made.id })).model).toEqual({
        providerID: "stub",
        id: "stub-model",
        variant: "default",
      })
      expect(
        (await made.client.message.list({ sessionID: made.id, order: "asc" })).data.map((message) => message.type),
      ).toEqual(["model-switched"])
    })

    test("switching to the agent the session already has still adds an agent-switched message, and the same model adds nothing", async () => {
      const made = fresh()
      await made.client.session.create({ id: made.id, agent: "build", model: { providerID: "stub", id: "stub-model" } })
      await made.client.session.switchAgent({ sessionID: made.id, agent: "build" })
      await made.client.session.switchModel({ sessionID: made.id, model: { providerID: "stub", id: "stub-model" } })
      expect(
        (await made.client.message.list({ sessionID: made.id, order: "asc" })).data.map((message) => message.type),
      ).toEqual(["agent-switched"])
    })
  })

  describe("instruction entries", () => {
    const put = (opened: Session, key: string, value: string) =>
      opened.client.session.instructions.entry.put({ sessionID: opened.id, key, value })

    const turn = async (opened: Session) => {
      const script = stub.script()
      await opened.prompt(`turn ${script.marker}`)
      await opened.wait()
      return script.calls[0]
    }

    const updates = (call: StubModel.Call | undefined) =>
      (call?.body.messages ?? []).flatMap((message) =>
        typeof message.content === "string" && message.content.startsWith("<system-update>") ? [message.content] : [],
      )

    test("an entry put before the first turn is in the first turn's system prompt, with no system update message", async () => {
      const opened = await session()
      await put(opened, "team", "Ren before the first turn")
      const call = await turn(opened)
      expect(call?.system).toContain("Ren before the first turn")
      expect(updates(call)).toEqual([])
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "idle:succeeded"])
    })

    test("putting the same value again adds no system update", async () => {
      const opened = await session()
      await put(opened, "team", "Ren")
      await turn(opened)
      await put(opened, "team", "Ren")
      expect(updates(await turn(opened))).toEqual([])
      expect(kinds(await opened.messages())).not.toContain("system")
    })

    test("changing an entry's value adds one system update with the new block before the next turn", async () => {
      const opened = await session()
      await put(opened, "team", "Ren")
      await turn(opened)
      await put(opened, "team", "Ren AI")
      const call = await turn(opened)
      expect(updates(call)).toHaveLength(1)
      expect(updates(call)[0]).toContain("Ren AI")
      expect(kinds(await opened.messages()).filter((kind) => kind === "system")).toHaveLength(1)
    })

    test("removing an entry adds a note that the key no longer applies", async () => {
      const opened = await session()
      await put(opened, "team", "Ren")
      await turn(opened)
      await opened.client.session.instructions.entry.remove({ sessionID: opened.id, key: "team" })
      expect(updates(await turn(opened))).toEqual([
        '<system-update>\nThe context under "team" no longer applies. Disregard it.\n</system-update>',
      ])
    })

    test("listing entries returns each key and value that was put", async () => {
      const opened = await session()
      await put(opened, "team", "Ren")
      await put(opened, "goal", "ship")
      expect(
        (await opened.client.session.instructions.entry.list({ sessionID: opened.id })).toSorted((left, right) =>
          left.key < right.key ? -1 : 1,
        ),
      ).toEqual([
        { key: "goal", value: "ship" },
        { key: "team", value: "Ren" },
      ])
    })

    test("a value whose JSON encoding is 256 KiB is accepted and one byte more is refused with InstructionEntryValueTooLargeError, matching Ren's limit", async () => {
      const opened = await session()
      await put(opened, "large", "a".repeat(256 * 1024 - 2))
      await expect(put(opened, "larger", "a".repeat(256 * 1024 - 1))).rejects.toMatchObject({
        _tag: "InstructionEntryValueTooLargeError",
        actualBytes: 256 * 1024 + 1,
      })
    })
  })

  describe("delivery", () => {
    test("a prompt sent to an idle session runs at once with either delivery", async () => {
      const ran = await Promise.all(
        (["steer", "queue"] as const).map(async (delivery) => {
          const opened = await session()
          const script = stub.script()
          await opened.prompt(`idle ${script.marker}`, { delivery })
          await opened.wait()
          return { calls: script.calls.length, kinds: kinds(await opened.messages()) }
        }),
      )
      expect(ran).toEqual([
        { calls: 1, kinds: ["user", "assistant", "idle:succeeded"] },
        { calls: 1, kinds: ["user", "assistant", "idle:succeeded"] },
      ])
    })
  })

  describe("prompts", () => {
    test("an inline text file is inlined into the prompt's text", async () => {
      const opened = await session()
      const script = stub.script()
      await opened.client.session.prompt({
        sessionID: opened.id,
        text: `file ${script.marker}`,
        files: [{ uri: "data:text/plain,hello%20text", name: "a.txt" }],
      })
      await opened.wait()
      expect(script.calls[0]?.body.messages.at(-1)?.content).toBe(
        `file ${script.marker}\n\nAttached file: a.txt\n\nhello text`,
      )
    })

    test("an inline file the model cannot read is replaced by a note telling the model so, and the turn succeeds", async () => {
      const opened = await session()
      const script = stub.script()
      await opened.client.session.prompt({
        sessionID: opened.id,
        text: `pdf ${script.marker}`,
        files: [{ uri: "data:application/pdf;base64,JVBERi0=", name: "a.pdf" }],
      })
      await opened.wait()
      expect(script.calls[0]?.text).toContain('ERROR: Cannot read "a.pdf" (this model does not support pdf input).')
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })
  })
})

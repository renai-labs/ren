import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Shared } from "./lib/shared.js"
import { StubModel } from "./lib/stub-model.js"
import { TestCell } from "./lib/test-cell.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(30_000)

const celld = await Shared.celld()
const stub = Shared.stub()
const removed = new Set(["read", "write", "edit", "patch", "glob", "grep", "shell"])
const png =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
const question = {
  questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
}

const message = () => `msg_${crypto.randomUUID().replaceAll("-", "")}`

const cell = async () => {
  const opened = await TestCell.make(celld.url)
  const start = (input: Record<string, unknown> = {}) =>
    opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode", ...input })
  const send = (text: string, input: Record<string, unknown> = {}) =>
    opened.brain(`/ren/sessions/${opened.id}/messages`, {
      messageId: message(),
      prompt: { text },
      sender: { userId: "user_1" },
      ...input,
    })
  return {
    ...opened,
    start,
    send,
    started: async (input: Record<string, unknown> = {}) => {
      const response = await start(input)
      if (response.status !== 200) throw new Error(`start answered ${response.status}: ${await response.text()}`)
    },
    wait: () => opened.opencode.session.wait({ sessionID: opened.id }),
    info: () => opened.opencode.session.get({ sessionID: opened.id }),
    ended: () => opened.until((state) => Bun.deepEquals(state, TestCell.closed)),
    updates: (call: StubModel.Call | undefined) =>
      (call?.body.messages ?? []).flatMap((item) =>
        typeof item.content === "string" && item.content.startsWith("<system-update>") ? [item.content] : [],
      ),
  }
}

const answer = async (response: Response) => ({ status: response.status, body: await response.json() })

describe("Brain API", () => {
  describe("access", () => {
    test("POST /ren/sessions and /ren/sessions/:id/messages answer 403 to a client token and 401 to a bad one", async () => {
      const opened = await cell()
      const client = TestToken.basic(opened.client)
      const bad = TestToken.basic("not-a-token")
      const statuses = await Promise.all(
        [client, bad].flatMap((authorization) => [
          opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode" }, authorization),
          opened.brain(`/ren/sessions/${opened.id}/messages`, {}, authorization),
        ]),
      )
      expect(statuses.map((response) => response.status)).toEqual([403, 403, 401, 401])
      expect(await opened.state()).toEqual(TestCell.closed)
    })

    test("a start whose body names another session than the token's answers 403, and nothing reaches OpenCode", async () => {
      const opened = await cell()
      const response = await opened.start({ sessionId: `ses_${crypto.randomUUID().replaceAll("-", "")}` })
      expect(await answer(response)).toMatchObject({ status: 403, body: { _tag: "ForbiddenError" } })
      expect((await opened.state()).harnessOpen).toBe(false)
      expect((await opened.opencode.session.list()).data).toEqual([])
    })

    test("a send whose path names another session than the token's answers 403, and nothing reaches OpenCode", async () => {
      const opened = await cell()
      const other = `ses_${crypto.randomUUID().replaceAll("-", "")}`
      const response = await opened.brain(`/ren/sessions/${other}/messages`, {
        messageId: message(),
        prompt: { text: "hello" },
        sender: { userId: "user_1" },
      })
      expect(await answer(response)).toMatchObject({ status: 403, body: { _tag: "ForbiddenError" } })
      expect((await opened.state()).harnessOpen).toBe(false)
    })

    test("a body that does not decode answers 400 with the API's error, and nothing reaches OpenCode", async () => {
      const opened = await cell()
      const responses = await Promise.all([
        opened.start({ harness: "claude-code" }),
        opened.start({ instructions: { Team: "Ren" } }),
        opened.send("", {}),
        opened.send("hello", { messageId: "not-a-message-id" }),
        opened.brain("/ren/sessions", "not json"),
      ])
      expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400])
      expect((await opened.state()).harnessOpen).toBe(false)
    })

    test("an unknown /ren/ path or method answers 404 and never reaches OpenCode", async () => {
      const opened = await cell()
      const responses = await Promise.all([
        opened.brain("/ren/unknown", {}),
        fetch(`${celld.url}/ren/sessions`, { headers: { authorization: opened.server } }),
        opened.brain(`/ren/sessions/${opened.id}`, {}),
      ])
      expect(responses.map((response) => response.status)).toEqual([404, 404, 404])
      expect((await opened.state()).harnessOpen).toBe(false)
    })
  })

  describe("start", () => {
    test("creates the OpenCode session with the Ren id, in /workspace, with the agent and model, and answers Started", async () => {
      const opened = await cell()
      const response = await opened.start({ agent: "build", model: { providerId: "stub", modelId: "stub-model" } })
      expect(await answer(response)).toEqual({ status: 200, body: { sessionId: opened.id, harness: "opencode" } })
      expect(await opened.info()).toMatchObject({
        id: opened.id,
        agent: "build",
        model: { providerID: "stub", id: "stub-model" },
        location: { directory: "/workspace" },
      })
    })

    test("a session started without a title gets OpenCode's title after its first turn", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script()
      await opened.send(`first ${script.marker}`)
      await stub.waitFor((call) => call.kind === "title" && call.marker === script.marker)
      await opened.wait()
      expect((await opened.info()).title).toBe("Stub title")
    })

    test("puts each instruction as an instruction entry, which the first turn's model call sees", async () => {
      const opened = await cell()
      await opened.started({ instructions: { team: "Ren builds cells", goal: "ship phase 2" } })
      const script = stub.script()
      await opened.send(`first ${script.marker}`)
      await script.called()
      await opened.wait()
      expect(script.calls[0]?.system).toContain("Ren builds cells")
      expect(script.calls[0]?.system).toContain("ship phase 2")
      expect(await opened.opencode.session.instructions.entry.list({ sessionID: opened.id })).toHaveLength(2)
    })

    test("start twice with the same input gives one session, the same answer and no second system update", async () => {
      const opened = await cell()
      const input = { title: "Fix", agent: "build", instructions: { team: "Ren" } }
      const first = await answer(await opened.start(input))
      await opened.send(`first ${stub.script().marker}`)
      await opened.wait()
      const second = await answer(await opened.start(input))
      const script = stub.script()
      await opened.send(`second ${script.marker}`)
      await opened.wait()
      expect(second).toEqual(first)
      expect((await opened.opencode.session.list()).data.map((session) => session.id)).toEqual([opened.id])
      expect(opened.updates(script.calls[0])).toEqual([])
      expect(TestCell.kinds((await opened.opencode.message.list({ sessionID: opened.id })).data)).not.toContain(
        "agent-switched",
      )
    })

    test("a second start applies a new title, agent and model to the next turn", async () => {
      const opened = await cell()
      await opened.started({ title: "First", agent: "build", model: { providerId: "stub", modelId: "stub-model" } })
      await opened.started({ title: "Second", agent: "plan", model: { providerId: "stub", modelId: "stub-other" } })
      const script = stub.script()
      await opened.send(`next ${script.marker}`)
      await opened.wait()
      const call = stub.calls.find(
        (item) => item.kind === "turn" && JSON.stringify(item.body.messages).includes(script.marker),
      )
      expect(call?.body.model).toBe("stub-other")
      expect(await opened.info()).toMatchObject({ title: "Second", agent: "plan" })
    })

    test("a model without a variant means the default variant: a second start moves a session on another variant back", async () => {
      const opened = await cell()
      await opened.started({ model: { providerId: "stub", modelId: "stub-model", variant: "high" } })
      expect((await opened.info()).model).toMatchObject({ variant: "high" })
      await opened.started({ model: { providerId: "stub", modelId: "stub-model" } })
      expect((await opened.info()).model).toEqual({ providerID: "stub", id: "stub-model", variant: "default" })
      await opened.started({ model: { providerId: "stub", modelId: "stub-model" } })
      expect(TestCell.kinds((await opened.opencode.message.list({ sessionID: opened.id, order: "asc" })).data)).toEqual(
        ["model-switched"],
      )
    })

    test("a second start that switches to the plan agent leaves its reminder waiting, and the cell still closes", async () => {
      const opened = await cell()
      await opened.started()
      await opened.started({ agent: "plan" })
      const reminded = async (): Promise<unknown> => {
        const inbox = await opened.opencode.session.inbox.list({ sessionID: opened.id })
        if (inbox.length > 0) return inbox
        await Bun.sleep(25)
        return reminded()
      }
      expect(await reminded()).toMatchObject([{ type: "synthetic" }])
      expect(await opened.ended()).toEqual(TestCell.closed)
      expect(await opened.opencode.session.inbox.list({ sessionID: opened.id })).toHaveLength(1)
    })

    test("a second start puts changed instructions and removes ones that left, and unchanged ones add nothing", async () => {
      const opened = await cell()
      await opened.started({ instructions: { team: "Ren", goal: "ship" } })
      await opened.send(`first ${stub.script().marker}`)
      await opened.wait()
      await opened.started({ instructions: { team: "Ren", note: "new block" } })
      const script = stub.script()
      await opened.send(`second ${script.marker}`)
      await opened.wait()
      const updates = opened.updates(script.calls[0])
      expect(updates).toHaveLength(1)
      expect(updates[0]).toContain("new block")
      expect(updates[0]).toContain('The context under "goal" no longer applies.')
      expect(updates[0]).not.toContain("&quot;team&quot;")
      expect(
        (await opened.opencode.session.instructions.entry.list({ sessionID: opened.id }))
          .map((entry) => entry.key)
          .toSorted(),
      ).toEqual(["note", "team"])
    })

    test("an unknown agent or model answers BrainRejectedError, and no session is created", async () => {
      const results = await Promise.all(
        [{ agent: "nope" }, { model: { providerId: "stub", modelId: "nope" } }].map(async (input) => {
          const opened = await cell()
          const response = await answer(await opened.start(input))
          return { response, sessions: (await opened.opencode.session.list()).data }
        }),
      )
      expect(results).toMatchObject([
        { response: { status: 422, body: { _tag: "BrainRejectedError" } }, sessions: [] },
        { response: { status: 422, body: { _tag: "BrainRejectedError" } }, sessions: [] },
      ])
    })

    test("an instruction over 256 KiB answers 400 before anything reaches OpenCode, so a repeated start changes nothing", async () => {
      const opened = await cell()
      await opened.started({ instructions: { team: "Ren" } })
      await opened.ended()
      const response = await opened.start({ instructions: { team: "changed", large: "a".repeat(256 * 1024) } })
      expect(response.status).toBe(400)
      expect((await opened.state()).harnessOpen).toBe(false)
      expect(await opened.opencode.session.instructions.entry.list({ sessionID: opened.id })).toEqual([
        { key: "team", value: "Ren" },
      ])
    })

    test("start on a busy session applies its changes without interrupting the running turn", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script({ hold: true, reply: "finished" })
      await opened.send(`hold ${script.marker}`)
      await script.called()
      await opened.started({ title: "While busy", instructions: { team: "Ren" } })
      script.release()
      await opened.wait()
      expect(await opened.info()).toMatchObject({ title: "While busy", outcome: "succeeded" })
      expect(script.calls).toHaveLength(1)
      expect(await opened.opencode.session.instructions.entry.list({ sessionID: opened.id })).toEqual([
        { key: "team", value: "Ren" },
      ])
    })

    test("start sets the alarm, and the cell closes after the interval when no turn runs", async () => {
      const opened = await cell()
      await opened.started()
      expect((await opened.state()).alarmAt).not.toBeNull()
      expect(await opened.ended()).toEqual(TestCell.closed)
    })
  })

  describe("interactive and not", () => {
    test("a non-interactive session's question call fails as a tool error, the turn ends succeeded and the cell closes", async () => {
      const opened = await cell()
      await opened.started({ interactive: false })
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.send(`ask ${script.marker}`)
      expect(await opened.ended()).toEqual(TestCell.closed)
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
      expect(script.calls.flatMap((call) => call.tools)).not.toContain("question")
    })

    test("an interactive session still asks, waits for an answer and is parked after the park time", async () => {
      const opened = await cell()
      await opened.started({ interactive: true })
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.send(`ask ${script.marker}`)
      await opened.until((state) => state.waiting !== null)
      expect(await opened.ended()).toEqual(TestCell.closed)
      expect(await opened.info()).toMatchObject({ outcome: "interrupted" })
      expect(script.calls[0]?.tools).toContain("question")
    })

    test("a second start can make a session non-interactive", async () => {
      const opened = await cell()
      await opened.started({ interactive: true })
      await opened.started({ interactive: false })
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.send(`ask ${script.marker}`)
      expect(await opened.ended()).toEqual(TestCell.closed)
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
      expect(script.calls.flatMap((call) => call.tools)).not.toContain("question")
    })
  })

  describe("send", () => {
    test("send before start answers SessionNotStartedError and runs no turn", async () => {
      const opened = await cell()
      const script = stub.script()
      expect(await answer(await opened.send(`early ${script.marker}`))).toMatchObject({
        status: 409,
        body: { _tag: "SessionNotStartedError" },
      })
      expect((await opened.opencode.session.list()).data).toEqual([])
      expect(script.calls).toEqual([])
    })

    test("answers Accepted with the message id before the turn ends, and the turn runs to the end with no client request", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script({ hold: true })
      const messageId = message()
      expect(await answer(await opened.send(`hold ${script.marker}`, { messageId }))).toEqual({
        status: 200,
        body: { messageId },
      })
      await script.called()
      script.release()
      expect(await opened.ended()).toEqual(TestCell.closed)
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })

    test("send with the same messageId twice answers the same and runs one turn", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script({ hold: true })
      const messageId = message()
      const first = await answer(await opened.send(`once ${script.marker}`, { messageId }))
      await script.called()
      const second = await answer(await opened.send(`once ${script.marker}`, { messageId }))
      script.release()
      await opened.wait()
      expect(second).toEqual(first)
      expect(script.calls).toHaveLength(1)
      expect(
        (await opened.opencode.message.list({ sessionID: opened.id })).data.filter((item) => item.id === messageId),
      ).toHaveLength(1)
    })

    test("send with the same messageId after the turn ended runs no second turn", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script()
      const messageId = message()
      await opened.send(`once ${script.marker}`, { messageId })
      await opened.wait()
      const before = TestCell.kinds((await opened.opencode.message.list({ sessionID: opened.id, order: "asc" })).data)
      expect((await opened.send(`once ${script.marker}`, { messageId })).status).toBe(200)
      await opened.wait()
      expect(script.calls).toHaveLength(1)
      expect(TestCell.kinds((await opened.opencode.message.list({ sessionID: opened.id, order: "asc" })).data)).toEqual(
        before,
      )
    })

    const busy = async () => {
      const opened = await cell()
      await opened.started({ interactive: false })
      const first = stub.script({ tool: { name: "question", input: question }, hold: true })
      await opened.send(`first ${first.marker}`)
      await first.called()
      return { opened, first }
    }

    test("steer on a busy session reaches the model at the running turn's next step", async () => {
      const busied = await busy()
      const steered = stub.script({ reply: "steered" })
      await busied.opened.send(`steer ${steered.marker}`, { delivery: "steer" })
      busied.first.release()
      await steered.called()
      await busied.opened.wait()
      expect(steered.calls[0]?.body.messages.map((item) => item.role).filter((role) => role !== "system")).toEqual([
        "user",
        "assistant",
        "tool",
        "user",
      ])
      expect(busied.first.calls).toHaveLength(1)
    })

    test("queue on a busy session runs after the running turn's last step", async () => {
      const busied = await busy()
      const queued = stub.script({ reply: "queued" })
      await busied.opened.send(`queue ${queued.marker}`, { delivery: "queue" })
      busied.first.release()
      await queued.called()
      await busied.opened.wait()
      expect(busied.first.calls).toHaveLength(2)
      expect(queued.calls[0]?.body.messages.map((item) => item.role).filter((role) => role !== "system")).toEqual([
        "user",
        "assistant",
        "tool",
        "assistant",
        "user",
      ])
    })

    test("the sender's user id is in the user message's metadata", async () => {
      const opened = await cell()
      await opened.started()
      const messageId = message()
      await opened.send(`meta ${stub.script().marker}`, { messageId, sender: { userId: "user_42" } })
      await opened.wait()
      expect(
        (await opened.opencode.message.list({ sessionID: opened.id })).data.find((item) => item.id === messageId),
      ).toMatchObject({ type: "user", metadata: { userID: "user_42" } })
    })

    test("an inline image reaches the model, and a file that is not a data: URL answers 400 with no turn", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script()
      await opened.send(`image ${script.marker}`, {
        prompt: { text: `image ${script.marker}`, files: [{ url: png, name: "dot.png" }] },
      })
      await opened.wait()
      expect(script.calls[0]?.body.messages.at(-1)?.content).toEqual([
        { type: "text", text: `image ${script.marker}` },
        { type: "image_url" },
      ])
      const remote = stub.script()
      const response = await opened.send(`remote ${remote.marker}`, {
        prompt: { text: `remote ${remote.marker}`, files: [{ url: "https://example.com/a.png" }] },
      })
      expect(response.status).toBe(400)
      expect(remote.calls).toEqual([])
    })
  })

  describe("the Ren plugin", () => {
    test("the model is never offered read, write, edit, patch, glob, grep or shell", async () => {
      const opened = await cell()
      await opened.started()
      const script = stub.script()
      await opened.send(`tools ${script.marker}`)
      await opened.wait()
      expect(script.calls[0]?.tools.filter((tool) => removed.has(tool))).toEqual([])
    })

    test("a subagent's model call is not offered them either", async () => {
      const opened = await cell()
      await opened.started()
      const child = stub.script({ reply: "child done" })
      const parent = stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "child task", prompt: `work ${child.marker}` },
        },
      })
      await opened.send(`delegate ${parent.marker}`)
      await opened.wait()
      expect(child.calls).toHaveLength(1)
      expect(child.calls[0]?.tools.filter((tool) => removed.has(tool))).toEqual([])
    })

    test("a session the client surface creates is not offered them either", async () => {
      const opened = await cell()
      const id = `ses_${crypto.randomUUID().replaceAll("-", "")}`
      const client = OpenCode.make({ baseUrl: celld.url, headers: { authorization: TestToken.basic(opened.client) } })
      await client.session.create({ id })
      const script = stub.script()
      await client.session.prompt({ sessionID: id, text: `tools ${script.marker}` })
      await client.session.wait({ sessionID: id })
      expect(script.calls[0]?.tools.filter((tool) => removed.has(tool))).toEqual([])
    })
  })

  describe("credentials", () => {
    const key = (value: string) => ({ type: "key", key: value })
    const managed = (value: string, expires: number) => ({ type: "managed", key: value, expires })
    const hour = 60 * 60 * 1000
    const turn = async (opened: Awaited<ReturnType<typeof cell>>, input: Record<string, unknown> = {}) => {
      const script = stub.script()
      await opened.send(`key ${script.marker}`, input)
      await opened.wait()
      return script.calls[0]?.authorization
    }

    test("the first turn's model call and its title call carry the key from start", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: key("sk-start") } })
      const script = stub.script()
      await opened.send(`hello ${script.marker}`)
      await opened.wait()
      const calls = stub.calls.filter((call) => call.marker === script.marker)
      expect(calls.map((call) => call.kind).toSorted()).toEqual(["title", "turn"])
      expect(calls.map((call) => call.authorization)).toEqual(["Bearer sk-start", "Bearer sk-start"])
    })

    test("a subagent's model call carries the key from start", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: key("sk-start") } })
      const child = stub.script({ reply: "child done" })
      const parent = stub.script({
        tool: {
          name: "subagent",
          input: { agent: "general", description: "child task", prompt: `work ${child.marker}` },
        },
      })
      await opened.send(`delegate ${parent.marker}`)
      await opened.wait()
      expect(child.calls.map((call) => call.authorization)).toEqual(["Bearer sk-start"])
    })

    test("a send with a newer Ren-managed key: the next model call carries it, even in the middle of a turn", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: managed("sk-first", Date.now() + hour) } })
      const first = stub.script({ hold: true })
      const second = stub.script()
      await opened.send(`first ${first.marker}`)
      await first.called()
      await opened.send(`second ${second.marker}`, {
        credentials: { stub: managed("sk-second", Date.now() + 2 * hour) },
      })
      first.release()
      await opened.wait()
      expect([first.calls[0]?.authorization, second.calls[0]?.authorization]).toEqual([
        "Bearer sk-first",
        "Bearer sk-second",
      ])
      expect(TestCell.kinds(await opened.messages()).filter((kind) => kind.startsWith("idle"))).toEqual([
        "idle:succeeded",
      ])
    })

    test("a send with an older Ren-managed key, or with no credentials, leaves the stored key", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: managed("sk-newer", Date.now() + 2 * hour) } })
      expect([
        await turn(opened, { credentials: { stub: managed("sk-older", Date.now() + hour) } }),
        await turn(opened),
      ]).toEqual(["Bearer sk-newer", "Bearer sk-newer"])
    })

    test("a send naming one provider leaves the others' credentials", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: key("sk-stub"), anthropic: key("sk-ant") } })
      expect(await turn(opened, { credentials: { stub: key("sk-stub-2") } })).toBe("Bearer sk-stub-2")
      const stored = await fetch(`${celld.url}/api/credential`, { headers: { authorization: opened.server } })
      expect(await stored.json()).toMatchObject({
        data: expect.arrayContaining([
          expect.objectContaining({ integrationID: "anthropic", value: { type: "key", key: "sk-ant" } }),
        ]),
      })
    })

    test("a second start that leaves a provider out removes its credential", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: key("sk-start") } })
      await opened.started({ credentials: {} })
      expect(await turn(opened)).toBe("Bearer stub-key")
    })

    test("a second start with another key for a provider replaces it", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: key("sk-first") } })
      await opened.started({ credentials: { stub: key("sk-second") } })
      expect(await turn(opened)).toBe("Bearer sk-second")
    })

    test("a key's configuration reaches the provider's settings, as the answers to its key form do", async () => {
      const opened = await cell()
      const baseURL = Shared.modelUrl().replace(/\/v1$/, "/configured/v1")
      await opened.started({ credentials: { stub: { type: "key", key: "sk-configured", configuration: { baseURL } } } })
      const script = stub.script()
      await opened.send(`configured ${script.marker}`)
      await opened.wait()
      expect(script.calls.map((call) => [call.path, call.authorization])).toEqual([
        ["/configured/v1/chat/completions", "Bearer sk-configured"],
      ])
    })

    test("a repeated start with Ren's older copy of a managed key keeps the cell's newer one", async () => {
      const opened = await cell()
      const older = { credentials: { stub: managed("sk-older", Date.now() + hour) } }
      await opened.started(older)
      expect(await turn(opened, { credentials: { stub: managed("sk-newer", Date.now() + 2 * hour) } })).toBe(
        "Bearer sk-newer",
      )
      await opened.started(older)
      expect(await turn(opened)).toBe("Bearer sk-newer")
    })

    test("an expired Ren-managed key fails the turn without a model call, naming the provider and the expiry, and a send with a fresh key runs the next turn", async () => {
      const opened = await cell()
      const expired = Date.now() - 1000
      await opened.started({ credentials: { stub: managed("sk-expired", expired) } })
      const script = stub.script()
      await opened.send(`expired ${script.marker}`)
      await opened.wait()
      expect(script.calls).toEqual([])
      expect((await opened.messages()).at(-1)).toMatchObject({
        type: "idle",
        outcome: "failed",
        error: {
          message: expect.stringContaining(
            `The model key for provider stub expired at ${new Date(expired).toISOString()}`,
          ),
        },
      })
      expect(await turn(opened, { credentials: { stub: managed("sk-fresh", Date.now() + hour) } })).toBe(
        "Bearer sk-fresh",
      )
    })

    test("a Ren-managed key within five minutes of its expiry is still used", async () => {
      const opened = await cell()
      await opened.started({ credentials: { stub: managed("sk-soon", Date.now() + 2 * 60 * 1000) } })
      expect(await turn(opened)).toBe("Bearer sk-soon")
    })

    test("credentials for a provider OpenCode does not know answer BrainRejectedError and change nothing", async () => {
      const opened = await cell()
      const response = await opened.start({ credentials: { stub: key("sk-start"), nobody: key("sk-nobody") } })
      expect(await answer(response)).toMatchObject({
        status: 422,
        body: { _tag: "BrainRejectedError", message: "Unknown provider: nobody" },
      })
      const stored = await fetch(`${celld.url}/api/credential`, { headers: { authorization: opened.server } })
      expect(await stored.json()).toMatchObject({ data: [] })
      expect((await opened.opencode.session.list()).data).toEqual([])
    })

    test("a key for the built-in anthropic provider reaches the model as x-api-key", async () => {
      const opened = await cell()
      await opened.started({
        model: { providerId: "anthropic", modelId: "stub-claude" },
        credentials: { anthropic: key("sk-ant") },
      })
      const script = stub.script({ reply: "from claude" })
      await opened.send(`claude ${script.marker}`)
      await opened.wait()
      expect(script.calls[0]).toMatchObject({ apiKey: "sk-ant", authorization: null })
      expect(await opened.info()).toMatchObject({ outcome: "succeeded" })
    })

    test("credentials never appear in the Brain API's answers or in /cell/state", async () => {
      const opened = await cell()
      const started = await (await opened.start({ credentials: { stub: key("sk-secret") } })).text()
      const sent = await (
        await opened.send("hello", { credentials: { stub: managed("sk-secret-2", Date.now() + hour) } })
      ).text()
      const state = JSON.stringify(await opened.state())
      expect([started, sent, state].filter((body) => body.includes("sk-secret"))).toEqual([])
    })

    test("a client token gets 403 on OpenCode's credential routes and integration connect routes, and a server token reaches them", async () => {
      const opened = await cell()
      const client = TestToken.basic(opened.client)
      const routes = [
        { method: "GET", path: "/api/credential" },
        { method: "POST", path: "/api/credential" },
        { method: "DELETE", path: "/api/credential/cred_ren_stub" },
        { method: "POST", path: "/api/integration/stub/connect/key" },
        { method: "POST", path: "/api/integration/stub/connect/oauth" },
        { method: "POST", path: "/api/experimental/integration/wellknown" },
      ]
      const statuses = await Promise.all(
        routes.map(async (route) => {
          const response = await fetch(`${celld.url}${route.path}`, {
            method: route.method,
            headers: { authorization: client },
          })
          return response.status
        }),
      )
      expect(statuses).toEqual(routes.map(() => 403))
      const listed = await fetch(`${celld.url}/api/credential`, { headers: { authorization: opened.server } })
      expect(listed.status).toBe(200)
      const integrations = await fetch(`${celld.url}/api/integration`, { headers: { authorization: client } })
      expect(integrations.status).toBe(200)
    })
  })
})

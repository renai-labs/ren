import { describe, expect, setDefaultTimeout, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { Schema } from "effect"
import { Shared } from "./lib/shared.js"
import { TestCell } from "./lib/test-cell.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(30_000)

const celld = await Shared.celld()
const stub = Shared.stub()
const interval = 1000
const budget = 3000
const park = 2000
const question = {
  questions: [{ question: "Which one?", header: "Pick", options: [{ label: "A", description: "a" }] }],
}
const closed = TestCell.closed
const kinds = TestCell.kinds
const sign = TestCell.sign
const cell = () => TestCell.make(celld.url)

describe("cell contract", () => {
  describe("tokens", () => {
    test("answers 401 to an expired, tampered, malformed or unknown-key token, with OpenCode's body for each", async () => {
      const opened = await cell()
      const other = await sign({ sid: "ses_other" })
      const tokens = [
        await sign({ sid: opened.id, exp: Math.floor(Date.now() / 1000) - 1 }),
        `${other.slice(0, other.indexOf("."))}${opened.client.slice(opened.client.indexOf("."))}`,
        "not-a-token",
        await sign({ sid: opened.id, kid: "gone" }),
        await sign({ sid: opened.id }, "a-secret-that-no-listed-key-has-at-all"),
      ]
      const responses = await Promise.all(
        tokens.map((token) =>
          fetch(`${celld.url}/api/session`, { headers: { authorization: TestToken.basic(token) } }).then(
            async (response) => ({
              status: response.status,
              type: response.headers.get("content-type"),
              body: await response.json(),
            }),
          ),
        ),
      )
      expect(responses).toEqual(
        tokens.map(() => ({
          status: 401,
          type: "application/json",
          body: { _tag: "UnauthorizedError", message: "Authentication required" },
        })),
      )
      expect(await opened.state()).toEqual(closed)
    })

    test("an OpenCode client with a bad token fails with OpenCode's own UnauthorizedError", async () => {
      const opened = await cell()
      const client = OpenCode.make({ baseUrl: celld.url, headers: { authorization: TestToken.basic("not-a-token") } })
      await expect(client.session.get({ sessionID: opened.id })).rejects.toMatchObject({
        _tag: "UnauthorizedError",
        message: "Authentication required",
      })
    })

    test("accepts the token as the password of Basic auth, with any user name", async () => {
      const opened = await cell()
      const statuses = await Promise.all(
        ["opencode", "", "anyone at all"].map(
          async (user) =>
            (await fetch(`${celld.url}/api/info`, { headers: { authorization: TestToken.basic(opened.client, user) } }))
              .status,
        ),
      )
      expect(statuses).toEqual([200, 200, 200])
    })

    test("answers 401 to a valid token sent as Bearer or as auth_token", async () => {
      const opened = await cell()
      const responses = await Promise.all([
        fetch(`${celld.url}/api/info`, { headers: { authorization: `Bearer ${opened.client}` } }),
        fetch(`${celld.url}/api/info?auth_token=${btoa(`opencode:${opened.client}`)}`),
      ])
      expect(responses.map((response) => response.status)).toEqual([401, 401])
      expect(await opened.state()).toEqual(closed)
    })

    test("a client token creates a session through the client surface and reads it back", async () => {
      const opened = await cell()
      const created = await opened.opencode.session.create({ id: opened.id, title: "Created" })
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toEqual(created)
      expect(created).toMatchObject({ id: opened.id, title: "Created" })
    })

    test("a server token reaches the client surface too", async () => {
      const opened = await cell()
      const server = OpenCode.make({ baseUrl: celld.url, headers: { authorization: opened.server } })
      await server.session.create({ id: opened.id })
      expect((await opened.opencode.session.get({ sessionID: opened.id })).id).toBe(opened.id)
    })
  })

  describe("routing", () => {
    test("two session ids reach two separate cells: a session created in one is not in the other", async () => {
      const first = await cell()
      const second = await cell()
      await first.start()
      expect((await second.opencode.session.list()).data).toEqual([])
      await expect(second.opencode.session.get({ sessionID: first.id })).rejects.toMatchObject({
        _tag: "SessionNotFoundError",
      })
      expect((await first.opencode.session.list()).data.map((session) => session.id)).toEqual([first.id])
    })

    test("one session id reaches the same cell on every request", async () => {
      const opened = await cell()
      await opened.start()
      const reads = await Promise.all(
        Array.from({ length: 5 }, () => opened.opencode.session.get({ sessionID: opened.id })),
      )
      expect(reads.map((session) => session.id)).toEqual(Array.from({ length: 5 }, () => opened.id))
    })

    test("other /cell/ paths answer 404 and never reach OpenCode", async () => {
      const opened = await cell()
      const responses = await Promise.all(
        [
          { path: "/cell/start", method: "POST" },
          { path: "/cell", method: "GET" },
          { path: "/cell/state/more", method: "GET" },
          { path: "/cell/state", method: "POST" },
        ].map((request) =>
          fetch(`${celld.url}${request.path}`, { method: request.method, headers: { authorization: opened.server } }),
        ),
      )
      expect(responses.map((response) => response.status)).toEqual([404, 404, 404, 404])
      expect(await opened.state()).toEqual(closed)
    })
  })

  describe("client surface", () => {
    test("forwards the method, path, query and body of any route", async () => {
      const opened = await cell()
      await opened.start()
      await opened.opencode.session.create({ id: `${opened.id}_second` })
      const renamed = await opened.request(`/api/session/${opened.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Renamed" }),
      })
      expect(renamed.status).toBeLessThan(300)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ title: "Renamed" })
      const page = async (limit: number) =>
        Schema.decodeUnknownSync(Schema.Struct({ data: Schema.Array(Schema.Unknown) }))(
          await (await opened.request(`/api/session?limit=${limit}`)).json(),
        ).data.length
      expect([await page(1), await page(2)]).toEqual([1, 2])
      expect((await opened.request(`/api/session/${opened.id}_second`, { method: "DELETE" })).status).toBeLessThan(300)
      expect(await page(2)).toBe(1)
    })

    test("passes OpenCode's status codes and bodies through unchanged, including 404", async () => {
      const opened = await cell()
      const missing = await opened.request("/api/session/ses_missing")
      expect(missing.status).toBe(404)
      expect(missing.headers.get("content-type")).toContain("application/json")
      expect(await missing.json()).toMatchObject({ _tag: "SessionNotFoundError" })
      const invalid = await opened.request("/api/session", { method: "POST", body: JSON.stringify({ id: 5 }) })
      expect(invalid.status).toBe(400)
      expect(await opened.opencode.session.list()).toMatchObject({ data: [] })
    })

    test("streams events to the client as they happen", async () => {
      const opened = await cell()
      const controller = new AbortController()
      const events = opened.opencode.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
      expect((await events.next()).value).toMatchObject({ type: "server.connected" })
      await opened.start()
      const until = async (): Promise<unknown> => {
        const next = await events.next()
        if (next.done) throw new Error("the event stream ended")
        return next.value.type === "session.created" ? next.value : until()
      }
      expect(await until()).toMatchObject({ type: "session.created", data: { sessionID: opened.id } })
      controller.abort()
    })

    test("the OpenCode client attaches with the token as its password, the way the TUI does", async () => {
      const opened = await cell()
      const headers = Service.headers({
        url: celld.url,
        auth: { type: "basic", username: "opencode", password: opened.client },
      })
      const attached = OpenCode.make({ baseUrl: celld.url, ...(headers ? { headers } : {}) })
      expect((await attached.server.info()).version).toBe("2.0.27")
      await attached.session.create({ id: opened.id })
      expect((await attached.session.list()).data.map((session) => session.id)).toEqual([opened.id])
    })
  })

  describe("/cell/state", () => {
    test("needs a server token: 401 without one and 403 with a client token", async () => {
      const opened = await cell()
      const statuses = await Promise.all(
        [{}, { authorization: TestToken.basic(opened.client) }, { authorization: opened.server }].map(
          async (headers) => (await fetch(`${celld.url}/cell/state`, { headers })).status,
        ),
      )
      expect(statuses).toEqual([401, 403, 200])
    })

    test("a fresh cell reports the harness closed, no leases, no alarm and no wait", async () => {
      expect(await (await cell()).state()).toEqual(closed)
    })

    test("never opens the harness, sets no alarm and holds no lease", async () => {
      const opened = await cell()
      const states = await Promise.all(Array.from({ length: 3 }, () => opened.state()))
      expect([...states, await opened.state()]).toEqual(Array.from({ length: 4 }, () => closed))
    })
  })

  describe("open and close", () => {
    test("a client request to a fresh cell sets the alarm before it reaches OpenCode", async () => {
      const opened = await cell()
      const before = Date.now()
      expect((await opened.request("/api/session/ses_missing")).status).toBe(404)
      const state = await opened.state()
      expect(state.alarmAt).toBeGreaterThanOrEqual(before + interval - 50)
      expect(state.alarmAt).toBeLessThanOrEqual(Date.now() + interval)
      const streaming = await cell()
      const stream = await streaming.stream()
      expect(await streaming.state()).toMatchObject({ harnessOpen: true, leases: 1, alarmAt: expect.any(Number) })
      stream.close()
    })

    test("a request leaves an alarm that is already set where it is", async () => {
      const opened = await cell()
      await opened.opencode.server.info()
      const first = await opened.state()
      await opened.opencode.server.info()
      const second = await opened.state()
      expect(first.alarmAt).not.toBeNull()
      expect(second.alarmAt).toBe(first.alarmAt)
    })

    test("the first client request opens the harness", async () => {
      const opened = await cell()
      expect((await opened.state()).harnessOpen).toBe(false)
      await opened.opencode.server.info()
      expect(await opened.state()).toMatchObject({ harnessOpen: true, leases: 0 })
    })

    test("concurrent first requests to a fresh cell all succeed", async () => {
      const opened = await cell()
      const infos = await Promise.all(Array.from({ length: 8 }, () => opened.opencode.server.info()))
      expect(infos.map((info) => info.version)).toEqual(Array.from({ length: 8 }, () => "2.0.27"))
      expect(await opened.state()).toMatchObject({ harnessOpen: true, leases: 0 })
    })

    test("an open event stream holds a lease until the client disconnects", async () => {
      const opened = await cell()
      const stream = await opened.stream()
      expect((await opened.state()).leases).toBe(1)
      stream.close()
      expect((await opened.until((state) => state.leases === 0)).leases).toBe(0)
    })

    test("the alarm after the interval reconciles an idle harness by closing it and setting no alarm", async () => {
      const opened = await cell()
      const started = Date.now()
      await opened.start()
      expect((await opened.state()).harnessOpen).toBe(true)
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(Date.now() - started).toBeGreaterThanOrEqual(interval)
    })

    test("an open event stream keeps the harness open across alarms", async () => {
      const opened = await cell()
      const stream = await opened.stream()
      const first = await opened.state()
      const later = await opened.until(
        (state) => state.alarmAt !== null && first.alarmAt !== null && state.alarmAt >= first.alarmAt + 2 * interval,
      )
      expect(later).toMatchObject({ harnessOpen: true, leases: 1 })
      stream.close()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })

    test("a request after the idle close opens the harness again and sees the same sessions and messages", async () => {
      const opened = await cell()
      await opened.start()
      await opened.prompt(`remember ${stub.script().marker}`)
      await opened.opencode.session.wait({ sessionID: opened.id })
      const messages = await opened.messages()
      await opened.until((state) => !state.harnessOpen)
      expect(await opened.messages()).toEqual(messages)
      expect((await opened.opencode.session.list()).data.map((session) => session.id)).toEqual([opened.id])
      expect((await opened.state()).harnessOpen).toBe(true)
    })
  })

  describe("reconcile", () => {
    test("a finished turn more than a page of messages back still reads as finished, and the cell closes", async () => {
      const opened = await cell()
      await opened.start()
      await opened.prompt(`once ${stub.script().marker}`)
      await opened.opencode.session.wait({ sessionID: opened.id })
      await Array.from({ length: 60 }).reduce<Promise<unknown>>(
        (previous) =>
          previous.then(() => opened.opencode.session.switchAgent({ sessionID: opened.id, agent: "build" })),
        Promise.resolve(),
      )
      const page = await opened.opencode.message.list({ sessionID: opened.id, order: "desc", limit: 50 })
      expect(page.data.every((message) => message.type === "agent-switched")).toBe(true)
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })

    test("a running turn keeps the harness open and shows a wait, and the harness closes after the turn ends", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      expect(await opened.until((state) => state.waiting !== null)).toMatchObject({ harnessOpen: true })
      script.release()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
    })

    test("a wait that outlives its budget ends and the alarm is set again, while the turn runs to the end", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const first = (await opened.until((state) => state.waiting !== null)).waiting ?? 0
      const between = await opened.until((state) => state.waiting !== first)
      expect(between).toMatchObject({ harnessOpen: true, alarmAt: expect.any(Number) })
      const second = (await opened.until((state) => state.waiting !== null)).waiting ?? 0
      expect(second - first).toBeGreaterThanOrEqual(budget)
      expect(script.calls).toHaveLength(1)
      script.release()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
      expect(script.calls).toHaveLength(1)
    })

    test("an alarm that falls due during a wait starts no second wait: the wait keeps its start time", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const waiting = await opened.until((state) => state.waiting !== null)
      const due = await opened.until((state) => state.alarmAt !== null && Date.now() > state.alarmAt + 200)
      expect(due.waiting).toBe(waiting.waiting)
      script.release()
      await opened.until((state) => !state.harnessOpen)
    })

    test("a running child session keeps the harness open while the root session is idle", async () => {
      const opened = await cell()
      await opened.start()
      const child = await opened.opencode.session.create({ id: `${opened.id}_child`, parentID: opened.id })
      const script = stub.script({ hold: true })
      await opened.opencode.session.prompt({ sessionID: child.id, text: `child ${script.marker}` })
      await script.called()
      const first = await opened.until((state) => state.waiting !== null)
      const later = await opened.until((state) => state.waiting !== null && state.waiting !== first.waiting)
      expect(later.harnessOpen).toBe(true)
      expect(Object.keys(await opened.opencode.session.active())).toEqual([child.id])
      script.release()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })

    test("a question answered within the park time continues the turn with the answer as the tool result", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.prompt(`ask ${script.marker}`)
      const form = await opened
        .until((state) => state.waiting !== null)
        .then(async function pending(): Promise<ReadonlyArray<{ readonly id: string }>> {
          const forms = await opened.opencode.session.form.list({ sessionID: opened.id })
          return forms.length > 0 ? forms : pending()
        })
      await opened.opencode.session.form.reply({ sessionID: opened.id, formID: form[0]?.id ?? "", answer: { q0: "A" } })
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
      expect(script.calls.at(-1)?.body.messages.at(-1)).toMatchObject({ role: "tool" })
      expect(JSON.stringify(script.calls.at(-1)?.body.messages.at(-1))).toContain('\\"Which one?\\"=\\"A\\"')
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })

    test("a question unanswered for the park time is parked: the turn is interrupted, the harness closes and no alarm is set", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ tool: { name: "question", input: question } })
      const asked = Date.now()
      await opened.prompt(`ask ${script.marker}`)
      const waiting = (await opened.until((state) => state.waiting !== null)).waiting ?? 0
      await opened.until((state) => state.waiting !== waiting)
      expect(Date.now() - waiting).toBeLessThan(budget)
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(Date.now() - asked).toBeGreaterThanOrEqual(park)
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "idle:interrupted"])
      expect(script.calls).toHaveLength(1)
    })

    test("an answer sent as a message after parking reopens the cell and the turn continues", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.prompt(`ask ${script.marker}`)
      await opened.until((state) => !state.harnessOpen)
      const answer = stub.script({ reply: "Going with A" })
      await opened.prompt(`User has answered your questions: "Which one?"="A". ${answer.marker}`)
      expect((await opened.state()).harnessOpen).toBe(true)
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect(
        answer.calls[0]?.body.messages.filter((message) => message.role !== "system").map((message) => message.role),
      ).toEqual(["user", "assistant", "tool", "user"])
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })

    test("a prompt queued behind a running turn runs after it with no client request", async () => {
      const opened = await cell()
      await opened.start()
      const first = stub.script({ hold: true, reply: "first answer" })
      const second = stub.script({ reply: "second answer" })
      await opened.prompt(`first ${first.marker}`)
      await first.called()
      await opened.prompt(`second ${second.marker}`, { delivery: "queue" })
      first.release()
      await second.called()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      const answers = (await opened.messages()).flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      )
      expect(answers).toEqual(["first answer", "second answer"])
    })

    test("a turn that fails on a model error OpenCode does not retry leaves the cell idle and closed", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ status: 400 })
      await opened.prompt(`fail ${script.marker}`)
      await script.called()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "failed" })
      expect(script.calls).toHaveLength(1)
    })

    test("a stream cut mid-way without a crash is continued, and the cell ends idle and closed", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ cut: true })
      await opened.prompt(`cut ${script.marker}`)
      await script.called()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
    })

    test("a turn that receives malformed model data leaves the cell idle and closed", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ malformed: true })
      await opened.prompt(`malformed ${script.marker}`)
      await script.called()
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "failed" })
    })

    test("an instruction entry put on an idle session leaves the cell idle and closed", async () => {
      const opened = await cell()
      await opened.start()
      await opened.prompt(`hello ${stub.script().marker}`)
      await opened.opencode.session.wait({ sessionID: opened.id })
      await opened.opencode.session.instructions.entry.put({ sessionID: opened.id, key: "team", value: "Ren" })
      expect(await opened.until((state) => !state.harnessOpen)).toEqual(closed)
    })
  })
})

import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { ManagedRuntime, Schema } from "effect"
import { Session } from "@ren/schema/session"
import type { Celld } from "./lib/celld.js"
import { Host } from "../src/harness/opencode/host.js"
import { Shared } from "./lib/shared.js"
import { TestCell } from "./lib/test-cell.js"
import { TestToken } from "./lib/token.js"

setDefaultTimeout(30_000)

const runtime = ManagedRuntime.make(Shared.layer)
let celld: Celld.Instance
beforeAll(async () => {
  celld = await runtime.runPromise(Shared.Service)
}, 120_000)
afterAll(() => runtime.dispose())
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
    test("client tokens cannot reach any Brain path or OpenCode credential and connect routes", async () => {
      const opened = await cell()
      const paths = [
        "/ren",
        "/ren/unknown/deeper",
        "/ren/sessions",
        `/ren/sessions/${opened.id}/messages`,
        "/ren/models",
        "/api/credential",
        "/api/credential/cred_ren_stub",
        "/api/integration/stub/connect/key",
        "/api/integration/stub/connect/oauth",
        "/api/experimental/integration/wellknown",
      ]
      expect(await Promise.all(paths.map(async (path) => (await opened.request(path)).status))).toEqual(
        paths.map(() => 403),
      )
      expect((await opened.brain("/ren/unknown/deeper", {})).status).toBe(404)
      expect(await opened.state()).toEqual(closed)
    })

    test("Brain payload validation rejects invalid and oversized files and instructions before opening the host", async () => {
      const opened = await cell()
      const files = [
        [{ url: "https://example.com/a.png" }],
        [{ url: `data:text/plain,${"a".repeat(Session.maxFileBytes + 1)}` }],
        [{ url: `data:text/plain,${"a".repeat(6_000_000)}` }, { url: `data:text/plain,${"b".repeat(6_000_000)}` }],
      ]
      const statuses = await Promise.all(
        files.map(
          async (input) =>
            (
              await opened.brain(`/ren/sessions/${opened.id}/messages`, {
                messageId: Session.MessageID.create(),
                prompt: { text: "look", files: input },
                sender: { userId: "user_1" },
              })
            ).status,
        ),
      )
      expect(statuses).toEqual([400, 400, 400])
      expect(
        (
          await opened.brain("/ren/sessions", {
            sessionId: opened.id,
            harness: "opencode",
            instructions: { team: "a".repeat(256 * 1024) },
          })
        ).status,
      ).toBe(400)
      expect(
        (
          await opened.brain("/ren/sessions", {
            sessionId: opened.id,
            harness: "opencode",
            initialMessage: {
              messageId: Session.MessageID.create(),
              prompt: { text: "look", files: files[1] },
              sender: { userId: "user_1" },
            },
          })
        ).status,
      ).toBe(400)
      expect(await opened.state()).toEqual(closed)
    })

    test("the worker bounds request bodies even without Content-Length", async () => {
      const opened = await cell()
      const state = { chunks: 0 }
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (state.chunks++ === 17) return controller.close()
          controller.enqueue(new Uint8Array(1_000_000))
        },
      })
      const streamed = await fetch(`${celld.url}/ren/sessions`, {
        method: "POST",
        headers: { authorization: opened.server },
        body,
      })
      expect({ status: streamed.status, body: await streamed.text() }).toEqual({ status: 413, body: "" })
      const declared = await opened.brain("/ren/sessions", { text: "a".repeat(Session.maxBodyBytes) })
      expect({ status: declared.status, body: await declared.text() }, await celld.logs()).toEqual({
        status: 413,
        body: "",
      })
      expect(await opened.state()).toEqual(closed)
    })

    test("start and send answer 409 before a model configuration and after its removal, and open no host", async () => {
      const opened = await cell()
      const started = await opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode" })
      const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
        messageId: Session.MessageID.create(),
        prompt: { text: "early" },
        sender: { userId: "user_1" },
      })
      expect([
        { status: started.status, body: await started.json() },
        { status: sent.status, body: await sent.json() },
      ]).toEqual(
        Array.from({ length: 2 }, () => ({
          status: 409,
          body: { _tag: "ModelsNotConfiguredError", message: "The brain has no model configuration" },
        })),
      )
      expect((await opened.models()).status).toBe(204)
      expect((await opened.removeModels()).status).toBe(204)
      const removed = await opened.brain("/ren/sessions", { sessionId: opened.id, harness: "opencode" })
      expect(removed.status).toBe(409)
      expect(await opened.state()).toEqual(closed)
    })

    test("endpoints become providers when the host opens, their efforts become variants, and their keys reach the model", async () => {
      const opened = await cell()
      const limit = { context: 100_000, output: 4000 }
      expect(
        (
          await opened.models({
            endpoints: [
              {
                id: "gateway",
                protocol: "openai-chat",
                baseUrl: stub.cellUrl,
                apiKey: Shared.apiKey("gateway-key"),
                models: [{ id: "stub-model", name: "Gateway", limit, efforts: ["low", "high"] }],
              },
              {
                id: "gateway-anthropic",
                protocol: "anthropic-messages",
                baseUrl: stub.cellUrl,
                apiKey: Shared.apiKey("anthropic-key", Date.now() + 3_600_000),
                models: [{ id: "stub-claude", name: "Gateway Claude", limit, efforts: ["low", "max"] }],
              },
              ...Shared.access({ stub: Shared.apiKey("unused") }).endpoints,
            ],
          })
        ).status,
      ).toBe(204)
      const chat = stub.script()
      const started = await opened.brain("/ren/sessions", {
        sessionId: opened.id,
        harness: "opencode",
        model: { endpointId: "gateway", modelId: "stub-model", variant: "high" },
        initialMessage: {
          messageId: Session.MessageID.create(),
          prompt: { text: `gateway ${chat.marker}` },
          sender: { userId: "user_1" },
        },
      })
      expect(started.status, await celld.logs()).toBe(200)
      await opened.opencode.session.wait({ sessionID: opened.id })
      const variants = (await opened.opencode.model.list()).data
        .filter((model) => model.providerID.startsWith("gateway"))
        .toSorted((left, right) => left.providerID.localeCompare(right.providerID))
        .map((model) => [model.providerID, model.variants.map((variant) => [variant.id, variant.settings])])
      expect(variants).toEqual([
        [
          "gateway",
          [
            ["low", { reasoningEffort: "low" }],
            ["high", { reasoningEffort: "high" }],
          ],
        ],
        [
          "gateway-anthropic",
          [
            ["low", { thinking: { type: "adaptive", display: "summarized" }, effort: "low" }],
            ["max", { thinking: { type: "adaptive", display: "summarized" }, effort: "max" }],
          ],
        ],
      ])
      const messages = stub.script()
      expect(
        (
          await opened.brain("/ren/sessions", {
            sessionId: opened.id,
            harness: "opencode",
            model: { endpointId: "gateway-anthropic", modelId: "stub-claude" },
          })
        ).status,
      ).toBe(200)
      await opened.brain(`/ren/sessions/${opened.id}/messages`, {
        messageId: Session.MessageID.create(),
        prompt: { text: `anthropic ${messages.marker}` },
        sender: { userId: "user_1" },
      })
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect([
        chat.calls.map((call) => [call.path, call.authorization]),
        messages.calls.map((call) => [call.path, call.authorization, call.apiKey]),
      ]).toEqual([[["/v1/chat/completions", "Bearer gateway-key"]], [["/v1/messages", "Bearer anthropic-key", null]]])
    })

    test("the deployed Brain API creates, sends and reports the same host under server authorization", async () => {
      const opened = await cell()
      expect((await opened.models()).status).toBe(204)
      const initial = stub.script()
      expect(
        (
          await opened.brain("/ren/sessions", {
            sessionId: opened.id,
            harness: "opencode",
            interactive: false,
            initialMessage: {
              messageId: Session.MessageID.create(),
              prompt: { text: `initial ${initial.marker}` },
              sender: { userId: "user_1" },
            },
          })
        ).status,
      ).toBe(200)
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect(initial.calls).toHaveLength(1)
      const script = stub.script()
      const messageId = Session.MessageID.create()
      const sent = await opened.brain(`/ren/sessions/${opened.id}/messages`, {
        messageId,
        prompt: { text: `hello ${script.marker}` },
        sender: { userId: "user_1" },
      })
      expect(await sent.json()).toEqual({ messageId })
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect(script.calls).toHaveLength(1)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
    })

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
  })

  describe("/ren/state", () => {
    test("needs a server token: 401 without one and 403 with a client token", async () => {
      const opened = await cell()
      const statuses = await Promise.all(
        [{}, { authorization: TestToken.basic(opened.client) }, { authorization: opened.server }].map(
          async (headers) => (await fetch(`${celld.url}/ren/state`, { headers })).status,
        ),
      )
      expect(statuses).toEqual([401, 403, 200])
    })

    test("a fresh cell reports the harness closed, no holders, no wait and no reconcile", async () => {
      expect(await (await cell()).state()).toEqual(closed)
    })

    test("never opens the harness, sets no alarm and does not hold it", async () => {
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
      expect(state.nextReconcileAt).toBeGreaterThanOrEqual(before + interval - 50)
      expect(state.nextReconcileAt).toBeLessThanOrEqual(Date.now() + interval)
      const streaming = await cell()
      const stream = await streaming.stream()
      expect(await streaming.state()).toMatchObject({ isOpen: true, holders: 1, nextReconcileAt: expect.any(Number) })
      stream.close()
    })

    test("a request leaves an alarm that is already set where it is", async () => {
      const opened = await cell()
      await opened.opencode.server.info()
      const first = await opened.state()
      await opened.opencode.server.info()
      const second = await opened.state()
      expect(first.nextReconcileAt).not.toBeNull()
      expect(second.nextReconcileAt).toBe(first.nextReconcileAt)
    })

    test("the first client request opens the harness", async () => {
      const opened = await cell()
      expect((await opened.state()).isOpen).toBe(false)
      await opened.opencode.server.info()
      expect(await opened.state()).toMatchObject({ isOpen: true, holders: 0 })
    })

    test("concurrent first requests to a fresh cell all succeed", async () => {
      const opened = await cell()
      const infos = await Promise.all(Array.from({ length: 8 }, () => opened.opencode.server.info()))
      expect(infos.map((info) => info.version)).toEqual(Array.from({ length: 8 }, () => Host.version))
      expect(await opened.state()).toMatchObject({ isOpen: true, holders: 0 })
    })

    test("an open event stream holds the harness until the client disconnects", async () => {
      const opened = await cell()
      const stream = await opened.stream()
      expect((await opened.state()).holders).toBe(1)
      stream.close()
      expect((await opened.until((state) => state.holders === 0, 45_000)).holders).toBe(0)
    }, 60_000)

    test("the alarm after the interval reconciles an idle harness by closing it and setting no alarm", async () => {
      const opened = await cell()
      const started = Date.now()
      await opened.start()
      expect((await opened.state()).isOpen).toBe(true)
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
      expect(Date.now() - started).toBeGreaterThanOrEqual(interval)
    })

    test("an open event stream keeps the harness open across alarms", async () => {
      const opened = await cell()
      const stream = await opened.stream()
      const first = await opened.state()
      const later = await opened.until(
        (state) =>
          state.nextReconcileAt !== null &&
          first.nextReconcileAt !== null &&
          state.nextReconcileAt >= first.nextReconcileAt + 2 * interval,
      )
      expect(later).toMatchObject({ isOpen: true, holders: 1 })
      stream.close()
      expect(await opened.until((state) => Bun.deepEquals(state, closed), 45_000)).toEqual(closed)
    }, 60_000)

    test("a request after the idle close opens the harness again and sees the same sessions and messages", async () => {
      const opened = await cell()
      await opened.start()
      await opened.prompt(`remember ${stub.script().marker}`)
      await opened.opencode.session.wait({ sessionID: opened.id })
      const messages = await opened.messages()
      await opened.until((state) => !state.isOpen)
      expect(await opened.messages()).toEqual(messages)
      expect((await opened.opencode.session.list()).data.map((session) => session.id)).toEqual([opened.id])
      expect((await opened.state()).isOpen).toBe(true)
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
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
    })

    test("a running turn keeps the harness open and shows a wait, and the harness closes after the turn ends", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      expect(await opened.until((state) => state.waitingSince !== null)).toMatchObject({ isOpen: true })
      script.release()
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
    })

    test("a wait that outlives its budget ends and the alarm is set again, while the turn runs to the end", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const first = (await opened.until((state) => state.waitingSince !== null)).waitingSince ?? 0
      const between = await opened.until((state) => state.waitingSince !== first)
      expect(between).toMatchObject({ isOpen: true, nextReconcileAt: expect.any(Number) })
      const second = (await opened.until((state) => state.waitingSince !== null)).waitingSince ?? 0
      expect(second - first).toBeGreaterThanOrEqual(budget)
      expect(script.calls).toHaveLength(1)
      script.release()
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
      expect(script.calls).toHaveLength(1)
    })

    test("an alarm that falls due during a wait starts no second wait: the wait keeps its start time", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ hold: true })
      await opened.prompt(`hold ${script.marker}`)
      await script.called()
      const waiting = await opened.until((state) => state.waitingSince !== null)
      const due = await opened.until(
        (state) => state.nextReconcileAt !== null && Date.now() > state.nextReconcileAt + 200,
      )
      expect(due.waitingSince).toBe(waiting.waitingSince)
      script.release()
      await opened.until((state) => !state.isOpen)
    })

    test("a running child session keeps the harness open while the root session is idle", async () => {
      const opened = await cell()
      await opened.start()
      const child = await opened.opencode.session.create({ id: `${opened.id}_child`, parentID: opened.id })
      const script = stub.script({ hold: true })
      await opened.opencode.session.prompt({ sessionID: child.id, text: `child ${script.marker}` })
      await script.called()
      const first = await opened.until((state) => state.waitingSince !== null)
      const later = await opened.until(
        (state) => state.waitingSince !== null && state.waitingSince !== first.waitingSince,
      )
      expect(later.isOpen).toBe(true)
      expect(Object.keys(await opened.opencode.session.active())).toEqual([child.id])
      script.release()
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
    })

    test("a question unanswered for the park time is parked: the turn is interrupted, the harness closes and no alarm is set", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ tool: { name: "question", input: question } })
      const asked = Date.now()
      await opened.prompt(`ask ${script.marker}`)
      const waiting = (await opened.until((state) => state.waitingSince !== null)).waitingSince ?? 0
      await opened.until((state) => state.waitingSince !== waiting)
      expect(Date.now() - waiting).toBeLessThan(budget)
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
      expect(Date.now() - asked).toBeGreaterThanOrEqual(park)
      expect(kinds(await opened.messages())).toEqual(["user", "assistant", "idle:interrupted"])
      expect(script.calls).toHaveLength(1)
    })

    test("an answer sent as a message after parking reopens the cell and the turn continues", async () => {
      const opened = await cell()
      await opened.start()
      const script = stub.script({ tool: { name: "question", input: question } })
      await opened.prompt(`ask ${script.marker}`)
      await opened.until((state) => !state.isOpen)
      const answer = stub.script({ reply: "Going with A" })
      await opened.prompt(`User has answered your questions: "Which one?"="A". ${answer.marker}`)
      expect((await opened.state()).isOpen).toBe(true)
      await opened.opencode.session.wait({ sessionID: opened.id })
      expect(
        answer.calls[0]?.body.messages.filter((message) => message.role !== "system").map((message) => message.role),
      ).toEqual(["user", "assistant", "tool", "user"])
      expect(await opened.opencode.session.get({ sessionID: opened.id })).toMatchObject({ outcome: "succeeded" })
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
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
      expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
      const answers = (await opened.messages()).flatMap((message) =>
        message.type === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
          : [],
      )
      expect(answers).toEqual(["first answer", "second answer"])
    })
  })
})

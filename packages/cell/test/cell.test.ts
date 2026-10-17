import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test"
import { ManagedRuntime, Schema } from "effect"
import { Session } from "@ren/schema/session"
import type { Celld } from "./lib/celld.js"
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
const closed = TestCell.closed
const cell = () => TestCell.make(celld.url)

describe("cell contract", () => {
  test("answers 401 without a token, to a malformed token and to a host token, with OpenCode's body", async () => {
    const opened = await cell()
    const headers = [
      {},
      { authorization: TestToken.basic("not-a-token") },
      { authorization: TestToken.basic(await TestCell.sign({ sid: opened.id, scope: "host" })) },
    ]
    const responses = await Promise.all(
      headers.map((header) =>
        fetch(`${celld.url}/api/session`, { headers: header }).then(async (response) => ({
          status: response.status,
          type: response.headers.get("content-type"),
          body: await response.json(),
        })),
      ),
    )
    expect(responses).toEqual(
      headers.map(() => ({
        status: 401,
        type: "application/json",
        body: { _tag: "UnauthorizedError", message: "Authentication required" },
      })),
    )
    expect(await opened.state()).toEqual(closed)
  })

  test("client tokens cannot reach any Brain path or OpenCode credential and connect routes; server tokens can", async () => {
    const opened = await cell()
    const paths = [
      "/ren",
      "/ren/state",
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
    expect(await opened.state()).toEqual(closed)
    const server = await Promise.all(
      ["/ren/state", "/api/credential"].map(
        async (path) => (await fetch(`${celld.url}${path}`, { headers: { authorization: opened.server } })).status,
      ),
    )
    expect([...server, (await opened.brain("/ren/unknown/deeper", {})).status]).toEqual([200, 200, 404])
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

  test("forwards the method, path, query and body of any route, and passes OpenCode's status codes and bodies through", async () => {
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
    const missing = await opened.request("/api/session/ses_missing")
    expect(missing.status).toBe(404)
    expect(missing.headers.get("content-type")).toContain("application/json")
    expect(await missing.json()).toMatchObject({ _tag: "SessionNotFoundError" })
    const invalid = await opened.request("/api/session", { method: "POST", body: JSON.stringify({ id: 5 }) })
    expect(invalid.status).toBe(400)
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

  test("an open event stream holds the harness until the client disconnects", async () => {
    const opened = await cell()
    const stream = await opened.stream()
    expect(await opened.state()).toMatchObject({ isOpen: true, holders: 1, nextReconcileAt: expect.any(Number) })
    stream.close()
    expect((await opened.until((state) => state.holders === 0, 45_000)).holders).toBe(0)
  }, 60_000)

  test("the idle alarm closes the harness with no alarm left, and a request after it sees the same sessions and messages", async () => {
    const opened = await cell()
    await opened.start()
    await opened.prompt(`remember ${stub.script().marker}`)
    await opened.opencode.session.wait({ sessionID: opened.id })
    const messages = await opened.messages()
    expect(await opened.until((state) => Bun.deepEquals(state, closed))).toEqual(closed)
    expect(await opened.messages()).toEqual(messages)
    expect((await opened.opencode.session.list()).data.map((session) => session.id)).toEqual([opened.id])
    expect((await opened.state()).isOpen).toBe(true)
  })
})

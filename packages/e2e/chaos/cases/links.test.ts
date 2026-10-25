import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { FakeRen } from "@ren/cell/testing"
import { Session } from "@ren/schema/session"
import { SessionDriver } from "../lib/drivers/session.js"
import { Ledger } from "../lib/ledger.js"
import { Platform } from "../lib/platform.js"
import { ModelProvider } from "../lib/provider/model.js"
import { Stack } from "../lib/stack.js"

const failed = (work: Promise<unknown>) =>
  work.then(
    () => false,
    () => true,
  )

const inWindow = () => Date.now() + 4 * 60_000

describe.skipIf(Platform.wrangler !== undefined)("a fault on one link", () => {
  const lane: { stack?: Stack.Instance; environment?: Stack.Environment } = {}

  const current = () => {
    if (!lane.stack || !lane.environment) throw new Error("the stack did not start")
    return { stack: lane.stack, environment: lane.environment }
  }

  beforeAll(async () => {
    lane.stack = await Stack.start()
    lane.environment = await lane.stack.environment("links")
  }, 180_000)

  afterAll(() => lane.stack?.dispose())

  const attached = () => current().stack.session({ environment: current().environment })

  const ledgerTurn = async (session: SessionDriver.Driver, label: string) => {
    const marker = Ledger.marker(label)
    const turn = await session.turn([
      ModelProvider.tool("shell", { command: Ledger.append(marker) }),
      ModelProvider.text("after tool"),
    ])
    return { marker, turn }
  }

  describe("core to brain", () => {
    test("a send whose acceptance reply is lost is retried with its ID and accepted once", async () => {
      const stack = current().stack
      const session = await stack.session()
      const script = stack.provider.script([ModelProvider.text("accepted once")])
      const messageId = Session.MessageID.create()
      const fault = stack.cellProxy.inject(
        { operation: `POST /ren/sessions/${session.id}/messages` },
        { type: "drop-response" },
      )
      expect(await failed(session.send(`first ${script.marker}`, { messageId }))).toBe(true)
      expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
      expect((await session.send(`first ${script.marker}`, { messageId })).status).toBe(200)
      expect(SessionDriver.occurrences(await session.settled(60_000), messageId)).toBe(1)
      expect(script.calls.filter((call) => call.kind === "turn")).toHaveLength(1)
    })

    test("a start whose reply is lost is retried and its initial message is accepted once", async () => {
      const stack = current().stack
      const session = await stack.session({ start: false })
      const script = stack.provider.script([ModelProvider.text("initial once")])
      const initialMessage = { messageId: Session.MessageID.create(), text: `initial ${script.marker}` }
      const fault = stack.cellProxy.inject({ operation: "POST /ren/sessions" }, { type: "drop-response" })
      expect(await failed(session.start({ initialMessage }))).toBe(true)
      fault.expectApplied()
      expect((await session.start({ initialMessage })).status).toBe(200)
      expect(SessionDriver.occurrences(await session.settled(60_000), initialMessage.messageId)).toBe(1)
      expect(script.calls).toHaveLength(1)
    })

    test("a wake whose reply is lost is applied, and an identical retry is harmless", async () => {
      const stack = current().stack
      const session = await stack.session()
      const key = Stack.freshKey("lost-reply")
      const fault = stack.cellProxy.inject({ operation: "POST /ren/wake" }, { type: "drop-response" })
      const hostToken = await FakeRen.hostToken(session.brainId, 7300)
      expect(await failed(session.configureModels(stack.access(key), hostToken))).toBe(true)
      fault.expectApplied()
      expect((await session.configureModels(stack.access(key), hostToken)).status).toBe(204)
      // oxlint-disable-next-line ren/no-comments -- A wake does not replace a model key that has not expired (HR29); the brain keeps answering with its own.
      const turn = await session.turn([ModelProvider.text("configured")])
      expect((await turn.script.called(1)).key).toBeString()
      expect(SessionDriver.assistantTexts(await session.settled()).join("")).toBe("configured")
    })
  })

  describe("user to brain", () => {
    test("a prompt refused before delivery is retried by ID and accepted once", async () => {
      const stack = current().stack
      const session = await stack.session()
      const script = stack.provider.script([ModelProvider.text("once")])
      const id = Session.MessageID.create()
      const prompt = () => session.opencode.session.prompt({ sessionID: session.id, id, text: `user ${script.marker}` })
      const fault = stack.cellProxy.inject({ operation: `POST /api/session/${session.id}/prompt` }, { type: "refuse" })
      expect(await failed(prompt())).toBe(true)
      fault.expectApplied()
      await prompt()
      expect(SessionDriver.occurrences(await session.settled(), id)).toBe(1)
      expect(script.calls).toHaveLength(1)
    })

    test("a prompt whose reply is lost is retried by ID and creates one message", async () => {
      const stack = current().stack
      const session = await stack.session()
      const script = stack.provider.script([ModelProvider.text("once")])
      const id = Session.MessageID.create()
      const prompt = () => session.opencode.session.prompt({ sessionID: session.id, id, text: `user ${script.marker}` })
      const fault = stack.cellProxy.inject(
        { operation: `POST /api/session/${session.id}/prompt` },
        { type: "drop-response" },
      )
      expect(await failed(prompt())).toBe(true)
      expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
      await failed(prompt())
      expect(SessionDriver.occurrences(await session.settled(), id)).toBe(1)
      expect(script.calls).toHaveLength(1)
    })

    test("a client keeps working after the user link returns, without a new client", async () => {
      const stack = current().stack
      const session = await stack.session()
      stack.cellProxy.partition(true)
      expect(await failed(session.opencode.session.get({ sessionID: session.id }))).toBe(true)
      stack.cellProxy.partition(false)
      expect((await session.opencode.session.get({ sessionID: session.id })).id).toBe(session.id)
    })
  })

  describe("brain to environment", () => {
    test("a spawn refused before delivery fails the tool and leaves no side effect", async () => {
      const lanes = current()
      const session = await attached()
      const fault = lanes.environment.proxy.inject({ operation: "process.spawn" }, { type: "refuse" })
      const run = await ledgerTurn(session, "spawn-refused")
      await run.turn.script.called(2, 60_000)
      fault.expectApplied()
      expect(await Ledger.count(lanes.environment.instance, run.marker)).toBe(0)
    })

    test("a spawn whose reply is lost ran once and is not resent by the brain", async () => {
      const lanes = current()
      const session = await attached()
      const fault = lanes.environment.proxy.inject({ operation: "process.spawn" }, { type: "drop-response" })
      const run = await ledgerTurn(session, "spawn-dropped")
      await run.turn.script.called(2, 60_000)
      expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
      expect(await Ledger.count(lanes.environment.instance, run.marker)).toBe(1)
      expect(lanes.environment.proxy.seen.filter((entry) => entry.body.includes(run.marker))).toHaveLength(1)
    })
  })

  describe("brain to core", () => {
    test("a refresh refused before delivery leaves the valid key in use", async () => {
      const stack = current().stack
      const key = Stack.freshKey("refuse")
      const session = await stack.session({ models: stack.access(key, inWindow()) })
      const fault = stack.renProxy.inject({ operation: "POST /host/models/refresh" }, { type: "refuse" })
      const turn = await session.turn([ModelProvider.text("fallback")])
      expect((await turn.script.called(1)).key).toBe(key)
      expect(fault.expectApplied().boundary).toBe("before-delivery")
    })

    test("a refresh whose grant is lost never puts the lost key in use, and a later refresh succeeds", async () => {
      const stack = current().stack
      const key = Stack.freshKey("current")
      const lostKey = Stack.freshKey("lost")
      const later = Stack.freshKey("later")
      const granted = { count: 0 }
      stack.ren.refresh(() => {
        granted.count += 1
        return { type: "grant", access: stack.access(granted.count === 1 ? lostKey : later, Date.now() + 3_600_000) }
      })
      const session = await stack.session({ models: stack.access(key, inWindow()) })
      const from = stack.provider.calls.length
      const fault = stack.renProxy.inject({ operation: "POST /host/models/refresh" }, { type: "drop-response" })
      const first = await session.turn([ModelProvider.text("first")])
      await first.script.called(1)
      await session.settled()
      expect(fault.expectApplied().boundary).toBe("after-commit-before-reply")
      const second = await session.turn([ModelProvider.text("second")])
      expect((await second.script.called(1)).key).toBe(later)
      const used = stack.provider.calls.slice(from).map((call) => call.key)
      expect(used.filter((used) => used !== key && used !== later)).toEqual([])
    })

    // oxlint-disable-next-line ren/no-comments -- Ren's next call to the brain carries a new host token (core/src/brain-client.ts) and Brains.call retries a ModelsNotConfiguredError; the wake with a fresh token stands in for that call.
    test("a rotating grant whose reply is lost is not retried in a loop; after a restart, Ren's next call with a new host token repairs the brain", async () => {
      const stack = current().stack
      stack.ren.rotate(true)
      stack.ren.refresh(() => ({ type: "grant", access: stack.access(Stack.freshKey("rotated"), inWindow()) }))
      const key = Stack.freshKey("current")
      const session = await stack.session({ models: stack.access(key, inWindow()) })
      const renewals = () =>
        stack.ren.calls.filter((call) => call.endpoint === "models.refresh" && call.brainId === session.brainId).length
      const lost = stack.renProxy.inject({ operation: "POST /host/models/refresh" }, { type: "drop-response" })
      const from = renewals()
      const keyOfTurn = async (text: string) => {
        const turn = await session.turn([ModelProvider.text(text)])
        const call = await turn.script.called(1)
        await session.settled()
        return call.key
      }
      const first = await keyOfTurn("rotation is lost")
      expect(lost.expectApplied().boundary).toBe("after-commit-before-reply")
      await stack.restartCell()
      expect((await session.send("refused")).status).toBe(409)
      stack.ren.rotate(false)
      const fresh = await FakeRen.hostToken(session.brainId, 9000)
      expect((await session.configureModels(stack.access(key, inWindow()), fresh)).status).toBe(204)
      const keys = [await keyOfTurn("after the repair"), await keyOfTurn("again")]
      expect([first, ...keys].every((each) => each !== undefined)).toBe(true)
      // oxlint-disable-next-line ren/no-comments -- One renewal per action (3 turns and the refused send), and one retry of the lost reply: no loop.
      expect(renewals() - from).toBeLessThanOrEqual(4 + 1)
    }, 240_000)
  })

  describe("brain to provider", () => {
    test("a model request refused before delivery ends in recovery or a bounded failure", async () => {
      const stack = current().stack
      const session = await stack.session()
      stack.providerProxy.inject(
        { operation: "POST /v1/chat/completions", when: (request) => request.body.includes("refused-link") },
        { type: "refuse" },
      )
      const turn = await session.turn([ModelProvider.text("after refusal")], "refused-link")
      expect(SessionDriver.lastIdle(await session.settled(90_000))).toBeDefined()
      expect(turn.script.calls.length).toBeLessThanOrEqual(5)
    })

    test("a model reply lost after a tool call was emitted never repeats the committed tool", async () => {
      const lanes = current()
      const session = await attached()
      const marker = Ledger.marker("provider-drop")
      lanes.stack.providerProxy.inject(
        {
          operation: "POST /v1/chat/completions",
          when: (request) => request.body.includes(marker) && request.body.includes('"role":"tool"'),
        },
        { type: "drop-response" },
      )
      const turn = await session.turn(
        [
          ModelProvider.tool("shell", { command: Ledger.append(marker) }),
          ModelProvider.text("after"),
          ModelProvider.text("retried"),
        ],
        marker,
      )
      await turn.script.called(2, 60_000)
      await session.settled(90_000)
      expect(await Ledger.count(lanes.environment.instance, marker)).toBe(1)
    })
  })

  test("an environment outage and an issuer outage together end the tool cleanly and keep credentials intact", async () => {
    const lanes = current()
    const session = await attached()
    const host = await FakeRen.hostToken(session.brainId, 7300)
    expect((await session.configureModels(lanes.stack.access(Stack.freshKey("both"), inWindow()), host)).status).toBe(
      204,
    )
    lanes.stack.ren.refresh(() => ({ type: "unavailable" }))
    lanes.environment.proxy.partition(true)
    const broken = await ledgerTurn(session, "both-down")
    await broken.turn.script.called(2, 90_000)
    lanes.environment.proxy.partition(false)
    expect(await Ledger.count(lanes.environment.instance, broken.marker)).toBe(0)
    lanes.stack.ren.refresh(() => ({
      type: "grant",
      access: lanes.stack.access(Stack.freshKey("renewed"), Date.now() + 3_600_000),
    }))
    const from = lanes.stack.ren.calls.filter((call) => call.endpoint === "models.refresh").length
    const healthy = await ledgerTurn(session, "both-up")
    await healthy.turn.script.called(2, 60_000)
    expect(await Ledger.count(lanes.environment.instance, healthy.marker)).toBe(1)
    expect(
      lanes.stack.ren.calls
        .filter((call) => call.endpoint === "models.refresh")
        .slice(from)
        .some((call) => call.status === 200),
    ).toBe(true)
  })
})

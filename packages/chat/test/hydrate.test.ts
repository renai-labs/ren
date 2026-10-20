import { describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import { SessionMessage } from "@ren/schema/session/message"
import { ChatState } from "../src/chat-state.js"
import { Hydrate } from "../src/hydrate.js"
import { Outbox } from "../src/outbox.js"
import { Reducer } from "../src/reducer.js"
import { Fixture } from "./lib/fixture.js"

const sessionID = Fixture.sessionID

describe("status", () => {
  test.each([
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.execution.started",
    "session.deleted",
  ] as const)("preserves %s activity when an older snapshot arrives", (type) => {
    const initial: ChatState.State =
      type === "session.execution.started"
        ? ChatState.empty
        : { ...ChatState.empty, active: { [sessionID]: "running" } }
    const connected = Reducer.connected(initial)
    expect(connected.commands).toEqual([{ _tag: "Refresh", read: { _tag: "Status" } }])
    const error = { type: "provider.no-route", message: "Model unavailable: opencode/gpt-5.2" }
    const applied = Reducer.apply(
      connected.state,
      Fixture.event({
        id: "evt_activity",
        created: 2,
        type,
        data: {
          sessionID,
          ...(type === "session.execution.interrupted" && { reason: "user" }),
          ...(type === "session.execution.failed" && { error }),
        },
      }),
    ).state
    const expected = type === "session.execution.started" ? "running" : "idle"
    expect(ChatState.activity(applied, sessionID)).toBe(expected)
    if (type === "session.execution.failed")
      expect(ChatState.messages(applied, sessionID).at(-1)).toEqual(
        Fixture.message({ id: "msg_activity", type: "idle", outcome: "failed", error, time: { created: 2 } }),
      )
    const hydrated = Hydrate.status(
      applied,
      {
        ...(type !== "session.execution.started" && { [sessionID]: { type: "busy" } }),
        ses_hydrated: { type: "busy" },
      },
      applied.connection,
    )
    expect(ChatState.activity(hydrated, "ses_hydrated")).toBe("running")
    expect(ChatState.activity(hydrated, sessionID)).toBe(expected)
  })

  test("ignores activity snapshots from an older connection", () => {
    const first = Reducer.connected(ChatState.empty).state
    const second = Reducer.connected(first).state
    const old = Hydrate.status(second, { ses_old: { type: "busy" } }, first.connection)
    const fresh = Hydrate.status(old, { ses_new: { type: "busy" } }, second.connection)
    expect(old).toBe(second)
    expect(ChatState.activity(fresh, "ses_new")).toBe("running")
    expect(ChatState.activity(fresh, "ses_old")).toBe("idle")
  })

  test("a failed status read ends the overlay without touching activity", () => {
    const running: ChatState.State = { ...ChatState.empty, active: { [sessionID]: "running" } }
    const connected = Reducer.connected(running).state
    const failed = Hydrate.statusFailed(connected, connected.connection)
    expect(failed.activeOverlay).toBeUndefined()
    expect(Hydrate.status(failed, {}, failed.connection)).toBe(failed)
    expect(ChatState.activity(failed, sessionID)).toBe("running")
  })
})

describe("pending", () => {
  const remote = Session.ID.make("ses_remote")
  const item = Fixture.inbox({
    id: "msg_remote",
    sessionID: remote,
    type: "user",
    delivery: "steer",
    time: { created: 1 },
    payload: { text: "Check the remote preview" },
  })
  const event = (id: string, created: number, type: SessionEvent.Type, data: object = {}) =>
    Fixture.event({ id, created, type, data: { sessionID: remote, inboxID: "msg_remote", ...data } })
  const enqueued = event("evt_enqueued", 1, "session.inbox.enqueued", {
    item: { type: "user", delivery: "steer", payload: { text: "Check the remote preview" } },
  })

  test.each(["delivered", "cancelled"] as const)("a delayed inbox snapshot cannot resurrect a %s prompt", (action) => {
    const reading = Hydrate.startPending(Reducer.apply(ChatState.empty, enqueued).state, remote)
    const consumed = Reducer.apply(reading, event("evt_consumed", 2, `session.inbox.${action}`)).state
    expect(ChatState.hasInput(consumed, remote, "msg_remote")).toBe(false)
    const hydrated = Hydrate.pending(consumed, remote, [item])
    expect(ChatState.hasInput(hydrated, remote, "msg_remote")).toBe(false)
    const message = ChatState.messages(hydrated, remote).find((entry) => entry.id === "msg_remote")
    if (action === "cancelled") expect(message).toBeUndefined()
    else expect(message?.time.created).toEqual(Fixture.at(2))
  })

  test.each(["enqueue", "delivery"] as const)("inbox hydration retains a concurrent %s event", (action) => {
    const reading = Hydrate.startPending(ChatState.empty, remote)
    const applied = Reducer.apply(
      reading,
      action === "enqueue"
        ? enqueued
        : event("evt_delivery", 2, "session.inbox.delivery.changed", { delivery: "steer" }),
    ).state
    const hydrated = Hydrate.pending(applied, remote, action === "enqueue" ? [] : [{ ...item, delivery: "queue" }])
    expect(ChatState.pending(hydrated, remote)).toEqual([item])
    expect(hydrated.pendingOverlay[remote]).toBeUndefined()
  })

  test("hydration preserves submission order across optimistic admissions", () => {
    const prompt = (id: string, text: string) => ({
      sessionID: remote,
      id: SessionMessage.ID.make(id),
      text,
      delivery: "steer" as const,
    })
    const first = Outbox.admit(ChatState.empty, prompt("msg_first", "First"), Fixture.at(1))
    const reading = Hydrate.startPending(first, remote)
    const second = Outbox.admit(reading, prompt("msg_second", "Second"), Fixture.at(2))
    const hydrated = Hydrate.pending(second, remote, [])
    expect(ChatState.inputs(hydrated, remote)).toEqual(Fixture.ids("msg_first", "msg_second"))
    expect([...hydrated.outbox]).toEqual(["msg_first", "msg_second"])
  })

  test("hydration coalesces a concurrent optimistic compaction even if its POST fails", () => {
    const compaction = (id: string) =>
      Fixture.inbox({ id, sessionID: remote, type: "compaction", delivery: "steer", time: { created: 1 }, payload: {} })
    const proposed = Reducer.admit(
      { ...ChatState.empty, outbox: new Set(["msg_proposed"]) },
      compaction("msg_proposed"),
    )
    const hydrated = Hydrate.pending(Hydrate.startPending(proposed, remote), remote, [compaction("msg_canonical")])
    expect(ChatState.pending(hydrated, remote)).toEqual([compaction("msg_canonical")])
    const failed = Outbox.rollback(hydrated, remote, "msg_proposed")
    expect(ChatState.pending(failed, remote)).toEqual([compaction("msg_canonical")])
  })

  test("preserves a fetched durable user when SSE is delayed and HTTP fails", () => {
    const id = SessionMessage.ID.make("msg_follow")
    const admitted = Outbox.admit(
      ChatState.empty,
      { sessionID, id, text: "Follow up", delivery: "steer" },
      Fixture.at(10),
    )
    const durable = Fixture.inbox({
      id,
      sessionID,
      type: "user",
      delivery: "steer",
      time: { created: 20 },
      payload: { text: "Follow up" },
    })
    const hydrated = Hydrate.pending(Hydrate.startPending(admitted, sessionID), sessionID, [durable])
    expect(ChatState.pending(hydrated, sessionID)).toEqual([durable])
    const failed = Outbox.rollback(hydrated, sessionID, id)
    expect(ChatState.pending(failed, sessionID)).toEqual([durable])
    expect(ChatState.messages(failed, sessionID)).toEqual([Fixture.user(id, 20, "Follow up")])
  })
})

describe("messages", () => {
  test("bulk history (success)", () => {
    const synced = Hydrate.messages(ChatState.empty, sessionID, Fixture.page([Fixture.user("msg_3", 3)], "recent"))
    expect(synced.cursor[sessionID]).toBe("recent")
    const newest = ChatState.messages(synced, sessionID)[0]
    const loaded = Hydrate.older(
      synced,
      sessionID,
      [Fixture.user("msg_3", 3), Fixture.user("msg_2", 2), Fixture.user("msg_1", 1)],
      undefined,
    )
    expect(ChatState.messages(loaded, sessionID).map((message) => message.id)).toEqual(
      Fixture.ids("msg_1", "msg_2", "msg_3"),
    )
    expect(ChatState.messages(loaded, sessionID).at(-1)).toBe(newest)
    expect(loaded.cursor[sessionID]).toBeUndefined()
  })

  test("a message read racing an optimistic admission keeps its local row", () => {
    const admitted = Outbox.admit(
      ChatState.empty,
      { sessionID, id: SessionMessage.ID.make("msg_local"), text: "local", delivery: "steer" },
      Fixture.at(5),
    )
    const synced = Hydrate.messages(admitted, sessionID, Fixture.page([Fixture.user("msg_page", 1)]))
    expect(ChatState.messages(synced, sessionID).map((message) => message.id)).toEqual(
      Fixture.ids("msg_page", "msg_local"),
    )
  })
})

describe("outbox", () => {
  const id = SessionMessage.ID.make("msg_local")
  const admitted = Outbox.admit(ChatState.empty, { sessionID, id, text: "local", delivery: "steer" }, Fixture.at(0))
  const echo = Fixture.event({
    id: "evt_msg_local",
    created: 1,
    type: "session.inbox.enqueued",
    data: { sessionID, inboxID: id, item: { type: "user", delivery: "steer", payload: { text: "local" } } },
  })

  test.each(["echo", "reject"] as const)("optimistic submissions stay until %s", (mode) => {
    expect(ChatState.messages(admitted, sessionID)).toEqual([Fixture.user(id, 0, "local")])
    const settled = Outbox.rollback(mode === "echo" ? Reducer.apply(admitted, echo).state : admitted, sessionID, id)
    expect(ChatState.messages(settled, sessionID)).toHaveLength(mode === "echo" ? 1 : 0)
    expect(ChatState.pending(settled, sessionID)).toHaveLength(mode === "echo" ? 1 : 0)
    expect(settled.outbox.size).toBe(0)
  })

  test("a retry of a rendered prompt does not admit it again", () => {
    const echoed = Reducer.apply(admitted, echo).state
    expect(Outbox.isFresh(echoed, sessionID, id)).toBe(false)
    expect(Outbox.admit(echoed, { sessionID, id, text: "local", delivery: "steer" }, Fixture.at(2))).toBe(echoed)
  })
})

describe("new chat handoff", () => {
  const id = SessionMessage.ID.make("msg_first")
  const handed = Outbox.admit(
    ChatState.empty,
    { sessionID, id, text: "Draft the report", delivery: "steer" },
    Fixture.at(1),
  )
  const unread = Hydrate.pending(Hydrate.startPending(handed, sessionID), sessionID, [])

  test("shows a new chat's first prompt before the session echoes it, through reads that miss it", () => {
    const read = Hydrate.messages(unread, sessionID, Fixture.page([]))
    expect(ChatState.messages(read, sessionID).map((message) => message.id)).toEqual([id])
    expect(ChatState.inputs(read, sessionID)).toEqual([id])
  })

  test("merges the first prompt into the server's copy once the session has delivered it", () => {
    const synced = Hydrate.messages(unread, sessionID, Fixture.page([Fixture.user("msg_first", 3, "Draft the report")]))
    expect(ChatState.messages(synced, sessionID)).toEqual([Fixture.user(id, 3, "Draft the report")])
    expect(ChatState.pending(synced, sessionID)).toEqual([])
    expect(synced.outbox.size).toBe(0)
  })
})

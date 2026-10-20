import { describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import type { SessionEvent } from "@ren/schema/session/event"
import type { SessionInbox } from "@ren/schema/session/inbox"
import { SessionMessage } from "@ren/schema/session/message"
import { ChatState } from "../src/chat-state.js"
import { Hydrate } from "../src/hydrate.js"
import { Outbox } from "../src/outbox.js"
import { Reducer } from "../src/reducer.js"
import { Fixture } from "./lib/fixture.js"

const sessionID = Fixture.sessionID

const loaded = Hydrate.messages(ChatState.empty, sessionID, Fixture.page([]))

const step = (id: string, created: number, type: SessionEvent.Type, data: object = {}) =>
  Fixture.event({
    id,
    created,
    type,
    data: { sessionID, assistantMessageID: "msg_assistant", ...data },
  })

describe("streaming", () => {
  test("streams a step from its start to the idle marker", () => {
    const started = Reducer.applyAll(loaded, [
      step("evt_step", 10, "session.step.started", { agent: "build", model: Fixture.model, started: 10 }),
      step("evt_streamed", 11, "session.step.streamed"),
      step("evt_reasoning", 12, "session.reasoning.started", { ordinal: 0 }),
      step("evt_reasoning_1", 12, "session.reasoning.delta", { ordinal: 0, delta: "Think" }),
      step("evt_reasoning_2", 12, "session.reasoning.delta", { ordinal: 0, delta: "ing" }),
      step("evt_text", 14, "session.text.started", { ordinal: 1 }),
      step("evt_text_1", 14, "session.text.delta", { ordinal: 1, delta: "Hel" }),
      step("evt_text_2", 14, "session.text.delta", { ordinal: 1, delta: "lo" }),
      step("evt_tool", 16, "session.tool.input.started", { id: "call_1", name: "bash" }),
      step("evt_tool_1", 16, "session.tool.input.delta", { id: "call_1", delta: '{"command":' }),
      step("evt_tool_2", 16, "session.tool.input.delta", { id: "call_1", delta: '"ls"}' }),
    ])
    expect(ChatState.messages(started.state, sessionID)).toEqual([
      Fixture.message({
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: Fixture.model,
        content: [
          { type: "reasoning", text: "Thinking", time: { created: 12 } },
          { type: "text", text: "Hello" },
          {
            type: "tool",
            id: "call_1",
            name: "bash",
            state: { status: "streaming", input: '{"command":"ls"}' },
            time: { created: 16 },
          },
        ],
        time: { created: 10, streamed: 11 },
      }),
    ])

    const finished = Reducer.applyAll(started.state, [
      step("evt_reasoning_end", 13, "session.reasoning.ended", { ordinal: 0, text: "Thinking." }),
      step("evt_text_end", 15, "session.text.ended", { ordinal: 1, text: "Hello." }),
      step("evt_tool_end", 16, "session.tool.input.ended", { id: "call_1", text: '{"command":"ls"}' }),
      step("evt_called", 17, "session.tool.called", { id: "call_1", input: { command: "ls" }, executed: false }),
      step("evt_progress", 18, "session.tool.progress", { id: "call_1", metadata: { lines: 1 } }),
      step("evt_success", 19, "session.tool.success", {
        id: "call_1",
        content: [{ type: "text", text: "file" }],
        metadata: { lines: 1 },
        executed: false,
      }),
      step("evt_ended", 20, "session.step.ended", { finish: "stop", cost: 0.5, tokens: Fixture.tokens }),
      Fixture.event({ id: "evt_done", created: 21, type: "session.execution.succeeded", data: { sessionID } }),
    ])
    expect(ChatState.messages(finished.state, sessionID)).toEqual([
      Fixture.message({
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: Fixture.model,
        content: [
          { type: "reasoning", text: "Thinking.", time: { created: 12, completed: 13 } },
          { type: "text", text: "Hello." },
          {
            type: "tool",
            id: "call_1",
            name: "bash",
            executed: false,
            state: {
              status: "completed",
              input: { command: "ls" },
              content: [{ type: "text", text: "file" }],
              metadata: { lines: 1 },
            },
            time: { created: 16, ran: 17, completed: 19 },
          },
        ],
        finish: "stop",
        cost: 0.5,
        tokens: Fixture.tokens,
        time: { created: 10, streamed: 11, completed: 20 },
      }),
      Fixture.message({ id: "msg_done", type: "idle", outcome: "succeeded", time: { created: 21 } }),
    ])
    expect([...started.commands, ...finished.commands]).toEqual([
      { _tag: "Revalidate", read: { _tag: "Info", sessionID } },
    ])
  })

  test("a new step completes the open assistant and clears its retry", () => {
    const result = Reducer.applyAll(loaded, [
      step("evt_step", 1, "session.step.started", { agent: "build", model: Fixture.model, started: 1 }),
      step("evt_retry", 2, "session.retry.scheduled", {
        attempt: 1,
        at: 5,
        error: { type: "provider", message: "Overloaded" },
      }),
      Fixture.event({
        id: "evt_next",
        created: 6,
        type: "session.step.started",
        data: { sessionID, assistantMessageID: "msg_next", agent: "build", model: Fixture.model, started: 6 },
      }),
    ])
    expect(ChatState.messages(result.state, sessionID)).toEqual([
      Fixture.message({
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: Fixture.model,
        content: [],
        time: { created: 1, completed: 6 },
      }),
      Fixture.message({
        id: "msg_next",
        type: "assistant",
        agent: "build",
        model: Fixture.model,
        content: [],
        time: { created: 6 },
      }),
    ])
  })

  test.each([
    step("evt_text", 1, "session.text.delta", { ordinal: 0, delta: "Hello" }),
    step("evt_tool", 1, "session.tool.called", { id: "call_1", input: {}, executed: false }),
    step("evt_ended", 1, "session.step.ended", { finish: "stop", cost: 0, tokens: Fixture.tokens }),
  ])("an event for an unknown assistant message settles the loaded messages ($type)", (event) => {
    const result = Reducer.apply(loaded, event)
    expect(result.state).toBe(loaded)
    expect(result.commands).toEqual([{ _tag: "Settle", read: { _tag: "Messages", sessionID } }])
    expect(Reducer.apply(ChatState.empty, event)).toEqual({ state: ChatState.empty, commands: [] })
  })

  test("reconciles a stale running tool when execution settles", () => {
    const assistant = (completed: boolean) =>
      Fixture.message({
        id: "msg_assistant",
        type: "assistant",
        agent: "build",
        model: Fixture.model,
        time: { created: 1, ...(completed && { completed: 2 }) },
        content: [
          {
            type: "tool",
            id: "call_execute",
            name: "execute",
            time: { created: 1, ran: 1, ...(completed && { completed: 2 }) },
            state: completed
              ? { status: "completed", input: {}, content: [{ type: "text", text: "done" }] }
              : { status: "running", input: {}, metadata: {} },
          },
        ],
      })
    const synced = Hydrate.messages(ChatState.empty, sessionID, Fixture.page([assistant(false)]))
    const interrupted = Reducer.apply(
      synced,
      Fixture.event({
        id: "evt_interrupted",
        created: 3,
        type: "session.execution.interrupted",
        data: { sessionID, reason: "user" },
      }),
    )
    expect(interrupted.commands).toEqual([
      { _tag: "Refresh", read: { _tag: "Messages", sessionID } },
      { _tag: "Revalidate", read: { _tag: "Info", sessionID } },
    ])
    const refetched = Hydrate.messages(interrupted.state, sessionID, Fixture.page([assistant(true)]))
    expect(ChatState.messages(refetched, sessionID)).toEqual([assistant(true)])
  })
})

describe("session info", () => {
  test("preserves a live session rename across concurrent session and family reads", () => {
    const event = Fixture.event({
      id: "evt_renamed",
      created: 1,
      type: "session.renamed",
      data: { sessionID, title: "Generated title" },
    })
    const reading = Reducer.apply(ChatState.empty, event)
    expect(reading).toEqual({
      state: ChatState.empty,
      commands: [{ _tag: "Rename", read: { _tag: "Info", sessionID }, title: "Generated title" }],
    })
    const stale = Hydrate.info(reading.state, [Fixture.session(sessionID)])
    expect(Hydrate.rename(stale, sessionID, "Generated title").info[sessionID]?.title).toBe("Generated title")
    expect(Hydrate.rename(ChatState.empty, sessionID, "Generated title")).toBe(ChatState.empty)
  })
})

describe("revert", () => {
  test("a committed revert drops the pending items and rows from its boundary on", () => {
    const user = (id: string, created: number) =>
      Fixture.inbox({ id, sessionID, type: "user", delivery: "queue", time: { created }, payload: { text: id } })
    const loaded = Hydrate.pending(
      Hydrate.messages(
        Hydrate.info(ChatState.empty, [Fixture.session(sessionID, { revert: { messageID: "msg_2" } })]),
        sessionID,
        Fixture.page([Fixture.user("msg_3", 3), Fixture.user("msg_2", 2), Fixture.user("msg_1", 1)]),
      ),
      sessionID,
      [user("msg_0", 0), user("msg_4", 4)],
    )
    const committed = Reducer.apply(
      loaded,
      Fixture.event({
        id: "evt_commit",
        created: 5,
        type: "session.revert.committed",
        data: { sessionID, to: "msg_2" },
      }),
    ).state
    expect(committed.info[sessionID]?.revert).toBeUndefined()
    expect(ChatState.pending(committed, sessionID).map((item) => item.id)).toEqual(Fixture.ids("msg_0"))
    expect(ChatState.messages(committed, sessionID).map((item) => item.id)).toEqual(Fixture.ids("msg_1"))
  })

  test("a commit keeps the prompt the member sends after it, which the echo has not reached yet", () => {
    const reverted = Hydrate.messages(
      Hydrate.info(ChatState.empty, [Fixture.session(sessionID, { revert: { messageID: "msg_2" } })]),
      sessionID,
      Fixture.page([Fixture.user("msg_2", 2), Fixture.user("msg_1", 1)]),
    )
    const sent = Outbox.admit(
      reverted,
      { sessionID, id: SessionMessage.ID.make("msg_3"), text: "next", delivery: "steer" },
      Fixture.at(3),
    )
    const committed = Reducer.apply(
      sent,
      Fixture.event({
        id: "evt_commit",
        created: 4,
        type: "session.revert.committed",
        data: { sessionID, to: "msg_2" },
      }),
    ).state
    expect(ChatState.messages(committed, sessionID).map((item) => item.id)).toEqual(Fixture.ids("msg_1", "msg_3"))
    expect(ChatState.pending(committed, sessionID).map((item) => item.id)).toEqual(Fixture.ids("msg_3"))
  })
})

describe("compaction", () => {
  const enqueue = (id: string, created = 10) =>
    Fixture.event({
      id: `evt_${id}_${created}`,
      created,
      type: "session.inbox.enqueued",
      data: { sessionID, inboxID: id, item: { type: "compaction", delivery: "steer", payload: {} } },
    })

  const item = (id: string, created = 10): SessionInbox.Compaction => ({
    id: SessionMessage.ID.make(id),
    sessionID,
    time: { created: Fixture.at(created) },
    type: "compaction",
    delivery: "steer",
    payload: {},
  })

  const proposed = SessionMessage.ID.make("msg_proposed")

  const propose = (state: ChatState.State) => Outbox.propose(state, sessionID, proposed, Fixture.at(10))

  const emit = (state: ChatState.State, ...events: ReadonlyArray<SessionEvent.Event>) =>
    Reducer.applyAll(state, events).state

  const consumed = {
    started: Fixture.event({
      id: "evt_started",
      created: 10,
      type: "session.compaction.started",
      data: { sessionID, inputID: "msg_canonical", reason: "manual", recent: "" },
    }),
    cancelled: Fixture.event({
      id: "evt_cancelled",
      created: 10,
      type: "session.inbox.cancelled",
      data: { sessionID, inboxID: "msg_canonical" },
    }),
    failed: Fixture.event({
      id: "evt_failed",
      created: 10,
      type: "session.compaction.failed",
      data: { sessionID, inputID: "msg_canonical", reason: "manual", error: { type: "aborted", message: "Cancelled" } },
    }),
  }

  test("a proposed compaction is pending but never a transcript row", () => {
    const compacting = propose(ChatState.empty)
    expect(ChatState.pending(compacting, sessionID)).toEqual([item("msg_proposed")])
    expect(ChatState.messages(compacting, sessionID)).toEqual([])
    expect(ChatState.inputs(compacting, sessionID)).toEqual([])
    const prompted = Outbox.admit(
      compacting,
      { sessionID, id: SessionMessage.ID.make("msg_follow"), text: "Follow up", delivery: "steer" },
      Fixture.at(11),
    )
    expect(ChatState.messages(prompted, sessionID)).toEqual([Fixture.user("msg_follow", 11, "Follow up")])
  })

  test("substitutes the canonical response ID and reconciles its later echo", () => {
    const compacting = propose(ChatState.empty)
    const read = Hydrate.pending(Hydrate.startPending(compacting, sessionID), sessionID, [])
    expect(ChatState.pending(read, sessionID).map((row) => row.id)).toEqual([proposed])
    const answered = Outbox.compacted(read, sessionID, proposed, item("msg_canonical"))
    expect(ChatState.pending(answered, sessionID)).toEqual([item("msg_canonical")])
    const echoed = emit(answered, enqueue("msg_canonical", 20))
    expect(ChatState.pending(echoed, sessionID)).toEqual([item("msg_canonical", 20)])
    expect(ChatState.inputs(echoed, sessionID)).toEqual([])
  })

  test.each(["proposed", "canonical"])("adopts the %s echo before the response without duplicating it", (kind) => {
    const id = kind === "proposed" ? proposed : "msg_canonical"
    const echoed = emit(propose(ChatState.empty), enqueue(id, 20))
    expect(ChatState.pending(echoed, sessionID)).toEqual([item(id, 20)])
    const answered = Outbox.compacted(echoed, sessionID, proposed, item(id))
    expect(ChatState.pending(answered, sessionID)).toEqual([item(id, 20)])
  })

  test.each(["started", "cancelled", "failed"] as const)(
    "does not resurrect a canonical item already %s before the response",
    (kind) => {
      const before = emit(propose(ChatState.empty), enqueue("msg_canonical"), consumed[kind])
      expect(ChatState.pending(before, sessionID)).toEqual([])
      const answered = Outbox.compacted(before, sessionID, proposed, item("msg_canonical"))
      expect(ChatState.pending(answered, sessionID)).toEqual([])
      expect(ChatState.inputs(answered, sessionID)).toEqual([])
      if (kind === "started")
        expect(ChatState.messages(answered, sessionID)).toMatchObject([{ type: "compaction", status: "running" }])
    },
  )

  test("rolls back a rejected compaction and keeps the following prompt", () => {
    const prompted = Outbox.admit(
      propose(ChatState.empty),
      { sessionID, id: SessionMessage.ID.make("msg_follow"), text: "Follow up", delivery: "steer" },
      Fixture.at(11),
    )
    const failed = Outbox.compactFailed(prompted, sessionID, proposed)
    expect(ChatState.pending(failed, sessionID).map((row) => row.type)).toEqual(["user"])
    expect(ChatState.messages(failed, sessionID)).toEqual([Fixture.user("msg_follow", 11, "Follow up")])
    expect(failed.compacting).toEqual({})
  })

  test.each(["proposed", "canonical", "existing"])(
    "preserves acknowledged %s compaction after an HTTP error",
    (kind) => {
      const before = kind === "existing" ? emit(ChatState.empty, enqueue("msg_canonical")) : ChatState.empty
      const compacting = propose(before)
      const id = kind === "proposed" ? proposed : "msg_canonical"
      const echoed = kind === "existing" ? compacting : emit(compacting, enqueue(id))
      expect(ChatState.pending(echoed, sessionID)).toEqual([item(id)])
      const failed = Outbox.compactFailed(echoed, sessionID, proposed)
      expect(ChatState.pending(failed, sessionID)).toEqual([item(id)])
    },
  )

  test("uses a fresh control ID when the known pending compaction starts during model setup", () => {
    const existing = emit(ChatState.empty, enqueue("msg_existing"))
    const compacting = propose(existing)
    expect(ChatState.pending(compacting, sessionID)).toEqual([item("msg_existing")])
    const started = emit(
      compacting,
      Fixture.event({
        id: "evt_started",
        created: 10,
        type: "session.compaction.started",
        data: { sessionID, inputID: "msg_existing", reason: "manual", recent: "" },
      }),
    )
    const answered = Outbox.compacted(started, sessionID, proposed, item("msg_proposed"))
    expect(ChatState.pending(answered, sessionID)).toEqual([item("msg_proposed")])
    expect(ChatState.messages(answered, sessionID)).toMatchObject([
      { id: "msg_existing", type: "compaction", status: "running" },
    ])
  })

  test("a started compaction folds into its completed summary", () => {
    const result = Reducer.applyAll(ChatState.empty, [
      enqueue("msg_canonical"),
      Fixture.event({
        id: "evt_started",
        created: 10,
        type: "session.compaction.started",
        data: { sessionID, inputID: "msg_canonical", reason: "manual", recent: "" },
      }),
      Fixture.event({
        id: "evt_delta",
        created: 11,
        type: "session.compaction.delta",
        data: { sessionID, text: "Sum" },
      }),
      Fixture.event({
        id: "evt_ended",
        created: 12,
        type: "session.compaction.ended",
        data: {
          sessionID,
          reason: "manual",
          model: Fixture.model,
          text: "Summary",
          recent: "Recent",
          cost: 0.01,
          tokens: Fixture.tokens,
        },
      }),
    ])
    expect(ChatState.messages(result.state, sessionID)).toEqual([
      Fixture.message({
        id: "msg_canonical",
        type: "compaction",
        status: "completed",
        reason: "manual",
        model: Fixture.model,
        summary: "Summary",
        recent: "Recent",
        cost: 0.01,
        tokens: Fixture.tokens,
        time: { created: 10 },
      }),
    ])
  })
})

describe("pending status", () => {
  const pendingSession = Session.ID.make("ses_pending")

  const fixture = () => {
    const current = { state: ChatState.empty, seq: 0 }
    const emit = (type: SessionEvent.Type, data: object = {}) => {
      current.seq += 1
      current.state = Reducer.apply(
        current.state,
        Fixture.event({
          id: `evt_${current.seq}`,
          type,
          created: current.seq,
          data: { sessionID: pendingSession, ...data },
        }),
      ).state
    }
    return {
      current,
      enqueue: (id: string, delivery: "steer" | "queue" = "steer") =>
        emit("session.inbox.enqueued", { inboxID: id, item: { type: "user", delivery, payload: { text: id } } }),
      deliver: (id: string) => emit("session.inbox.delivered", { inboxID: id }),
      started: () => emit("session.execution.started"),
      settled: (outcome: "succeeded" | "failed" | "interrupted") =>
        emit(`session.execution.${outcome}`, {
          ...(outcome === "failed" && { error: { type: "provider", message: "Provider unavailable" } }),
          ...(outcome === "interrupted" && { reason: "user" }),
        }),
      move: (id: string, delivery: "steer" | "queue") =>
        emit("session.inbox.delivery.changed", { inboxID: id, delivery }),
      status: (id: string) => ChatState.pendingStatus(current.state, pendingSession, id),
    }
  }

  test("an idle send is starting from optimistic admission until delivery", () => {
    const setup = fixture()
    setup.current.state = Outbox.admit(
      setup.current.state,
      { sessionID: pendingSession, id: SessionMessage.ID.make("msg_first"), text: "first", delivery: "steer" },
      Fixture.at(0),
    )
    expect(setup.status("msg_first")).toBe("starting")
    setup.current.state = { ...setup.current.state, active: { [pendingSession]: "running" } }
    expect(setup.status("msg_first")).toBe("starting")
    setup.enqueue("msg_first")
    expect(setup.status("msg_first")).toBe("starting")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    setup.deliver("msg_first")
    expect(setup.status("msg_first")).toBeUndefined()
    expect(ChatState.messages(setup.current.state, pendingSession).find((item) => item.id === "msg_first")?.type).toBe(
      "user",
    )
  })

  test("a steer sent after the execution delivered input is steering, and follows delivery changes", () => {
    const setup = fixture()
    setup.enqueue("msg_first")
    setup.started()
    setup.deliver("msg_first")
    setup.enqueue("msg_steer")
    expect(setup.status("msg_steer")).toBe("steering")
    setup.move("msg_steer", "queue")
    expect(setup.status("msg_steer")).toBe("queued")
    setup.move("msg_steer", "steer")
    expect(setup.status("msg_steer")).toBe("steering")
    setup.deliver("msg_steer")
    expect(setup.status("msg_steer")).toBeUndefined()
  })

  test("rapid follow-ups join the starting execution until it delivers without them", () => {
    const setup = fixture()
    setup.enqueue("msg_first")
    setup.started()
    setup.enqueue("msg_second")
    expect(setup.status("msg_first")).toBe("starting")
    expect(setup.status("msg_second")).toBe("starting")
    setup.deliver("msg_first")
    expect(setup.status("msg_second")).toBe("steering")
  })

  test.each(["failed", "interrupted"] as const)("an undelivered steer is stranded after execution %s", (outcome) => {
    const setup = fixture()
    setup.enqueue("msg_first")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    setup.settled(outcome)
    expect(ChatState.activity(setup.current.state, pendingSession)).toBe("idle")
    expect(setup.status("msg_first")).toBe("stranded")
    setup.enqueue("msg_retry")
    expect(setup.status("msg_retry")).toBe("starting")
    expect(setup.status("msg_first")).toBe("stranded")
    setup.started()
    expect(setup.status("msg_first")).toBe("starting")
    expect(setup.status("msg_retry")).toBe("starting")
  })

  test("a later execution starts fresh after an earlier turn delivered input", () => {
    const setup = fixture()
    setup.enqueue("msg_first")
    setup.started()
    setup.deliver("msg_first")
    setup.settled("succeeded")
    setup.enqueue("msg_next")
    expect(setup.status("msg_next")).toBe("starting")
    setup.started()
    expect(setup.status("msg_next")).toBe("starting")
  })

  test("a remote idle prompt is starting", () => {
    const setup = fixture()
    setup.enqueue("msg_remote")
    expect(setup.status("msg_remote")).toBe("starting")
    setup.started()
    expect(setup.status("msg_remote")).toBe("starting")
  })

  test("a queued prompt is queued regardless of execution state", () => {
    const setup = fixture()
    setup.enqueue("msg_queued", "queue")
    expect(setup.status("msg_queued")).toBe("queued")
    setup.started()
    expect(setup.status("msg_queued")).toBe("queued")
  })
})

describe("running shells", () => {
  const shell = (id: string, created: number) =>
    Fixture.event({
      id: `evt_${id}`,
      created,
      type: "shell.created",
      data: { info: { id, sessionID, status: "running", command: "sleep 30", time: { started: created } } },
    })

  test("a created shell joins the running shells, and leaves once it exits or is removed", () => {
    const started = Reducer.applyAll(ChatState.empty, [shell("sh_one", 1), shell("sh_two", 2)]).state
    expect<ReadonlyArray<string>>(ChatState.shells(started, sessionID).map((info) => info.id)).toEqual([
      "sh_one",
      "sh_two",
    ])
    const ended = Reducer.applyAll(started, [
      Fixture.event({ id: "evt_exit", created: 3, type: "shell.exited", data: { id: "sh_one", status: "exited" } }),
      Fixture.event({ id: "evt_remove", created: 4, type: "shell.deleted", data: { id: "sh_two" } }),
    ]).state
    expect(ChatState.shells(ended, sessionID)).toEqual([])
  })

  test("a shell tool's result, a shell's completion notice and a user shell re-read the shells once they were read", () => {
    const tool = Fixture.message({
      id: "msg_assistant",
      type: "assistant",
      agent: "build",
      model: Fixture.model,
      content: [
        {
          type: "tool",
          id: "call_shell",
          name: "shell",
          state: { status: "running", input: { command: "sleep 30" }, metadata: {} },
          time: { created: 1 },
        },
        {
          type: "tool",
          id: "call_read",
          name: "read",
          state: { status: "running", input: {}, metadata: {} },
          time: { created: 1 },
        },
      ],
      time: { created: 1 },
    })
    const events = [
      step("evt_shell", 2, "session.tool.success", {
        id: "call_shell",
        content: [{ type: "text", text: "moved to the background" }],
        metadata: { status: "running", shellID: "sh_one" },
        executed: true,
      }),
      step("evt_read", 2, "session.tool.success", {
        id: "call_read",
        content: [{ type: "text", text: "read" }],
        executed: true,
      }),
      Fixture.event({
        id: "evt_notice",
        created: 3,
        type: "session.inbox.enqueued",
        data: {
          sessionID,
          inboxID: "msg_notice",
          item: {
            type: "synthetic",
            payload: { text: "done", metadata: { source: "shell", shellID: "sh_one" } },
            delivery: "steer",
          },
        },
      }),
      Fixture.event({
        id: "evt_user_shell",
        created: 4,
        type: "session.shell.started",
        data: { sessionID, shell: { id: "sh_two", status: "running", command: "ls", time: { started: 4 } } },
      }),
    ]
    const transcript = Hydrate.messages(ChatState.empty, sessionID, Fixture.page([tool]))
    const settle: Reducer.Command = { _tag: "Settle", read: { _tag: "Shells" } }
    expect(Reducer.applyAll(transcript, events).commands.filter((command) => command.read._tag === "Shells")).toEqual(
      [],
    )
    expect(
      Reducer.applyAll(Hydrate.shells(transcript, []), events).commands.filter(
        (command) => command.read._tag === "Shells",
      ),
    ).toEqual([settle, settle, settle])
  })
})

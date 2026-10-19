import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session-message"
import { ChatState } from "../src/chat-state.js"
import { Hydrate } from "../src/hydrate.js"
import { Projection } from "../src/projection.js"
import { TimelineDetail } from "../src/timeline-detail.js"
import { TimelineRow } from "../src/timeline-row.js"
import { Fixture } from "./lib/fixture.js"

const sessionID = Fixture.sessionID

const assistant = (id: string, created: number, content: ReadonlyArray<object> = []) =>
  Fixture.message({ id, type: "assistant", agent: "build", model: Fixture.model, content, time: { created } })

const ids = (list: ReadonlyArray<{ readonly id: string }>) => list.map((message): string => message.id)

const messages = [
  Fixture.user("msg_1", 1, "first"),
  assistant("msg_2", 2),
  Fixture.user("msg_3", 3, "queued"),
  Fixture.user("msg_4", 4, "reverted"),
]

describe("visibleTimelineMessages", () => {
  const input = (id: string, delivery: "steer" | "queue") =>
    Fixture.inbox({ id, sessionID, time: { created: 3 }, type: "user", delivery, payload: { text: "queued" } })

  const steer = input("msg_3", "steer")

  const work = Fixture.message({
    id: "msg_5",
    type: "assistant",
    agent: "build",
    model: Fixture.model,
    content: [
      {
        type: "tool",
        id: "tool_read",
        name: "read",
        state: {
          status: "completed",
          input: { filePath: "src/example.ts" },
          content: [{ type: "text", text: "export const example = true" }],
          metadata: {},
        },
        time: { created: 5, completed: 6 },
      },
    ],
    time: { created: 5, completed: 6 },
  })

  test("keeps work above an undelivered steer without adding a thinking row", () => {
    const source = [...messages.slice(0, 3), work]
    const visible = ChatState.visibleMessages(source, [steer])
    expect(ids(visible)).toEqual(["msg_1", "msg_2", "msg_5", "msg_3"])
    expect(ids(source)).toEqual(["msg_1", "msg_2", "msg_3", "msg_5"])
    expect(visible[2]).toBe(work)
    const projection = Projection.project({
      messages: visible,
      busy: true,
      detail: TimelineDetail.presets[2].value,
      pendingInputIDs: new Set([steer.id]),
    })
    expect(projection.activeMessageID).toBe("msg_1")
    expect(projection.rows.map((row) => [row._tag, row.userMessageID])).toEqual([
      ["UserMessage", "msg_1"],
      ["AssistantPart", "msg_1"],
      ["TurnGap", "msg_3"],
      ["UserMessage", "msg_3"],
    ])
    expect(projection.rows.map(TimelineRow.key)).toContain("user-message:msg_1")
  })

  test("moves a queued input after existing work when changed to steer", () => {
    const source = [...messages.slice(0, 3), work]
    expect(ids(ChatState.visibleMessages(source, [input("msg_3", "queue")]))).toEqual(["msg_1", "msg_2", "msg_5"])
    expect(ids(ChatState.visibleMessages(source, [steer]))).toEqual(["msg_1", "msg_2", "msg_5", "msg_3"])
    const delivered = [messages[0], messages[1], work, messages[2]].filter((message) => message !== undefined)
    expect(ChatState.visibleMessages(delivered, [])).toBe(delivered)
  })

  test("preserves pending input order and excludes reverted steers", () => {
    const source = [...messages, work]
    const pending = [steer, input("msg_4", "steer")]
    expect(ids(ChatState.visibleMessages(source, pending))).toEqual(["msg_1", "msg_2", "msg_5", "msg_3", "msg_4"])
    const notice = Fixture.inbox({
      id: "msg_4a",
      sessionID,
      time: { created: 4 },
      type: "synthetic",
      delivery: "steer",
      payload: { text: "", description: "Task finished" },
    })
    const noticeMessage = Fixture.message({
      id: "msg_4a",
      type: "synthetic",
      text: "",
      description: "Task finished",
      time: { created: 4 },
    })
    expect(ids(ChatState.visibleMessages([...messages, noticeMessage, work], [...pending, notice]))).toEqual([
      "msg_1",
      "msg_2",
      "msg_5",
      "msg_3",
      "msg_4",
      "msg_4a",
    ])
    expect(ids(ChatState.visibleMessages(source, pending, "msg_4"))).toEqual(["msg_1", "msg_2", "msg_3"])
  })

  test("hides queued inputs until delivery", () => {
    expect(ids(ChatState.visibleMessages(messages, [input("msg_3", "queue")]))).toEqual(["msg_1", "msg_2", "msg_4"])
  })

  test("hides the staged revert boundary and later messages", () => {
    expect(ids(ChatState.visibleMessages(messages, [], "msg_4"))).toEqual(["msg_1", "msg_2", "msg_3"])
    expect(ChatState.visibleMessages(messages, [], "msg_0")).toEqual([])
  })

  test("keeps a pre-promotion failed idle marker after the pending input that triggered it", () => {
    const failed = [
      Fixture.user("msg_3", 3, "queued"),
      Fixture.message({
        id: "msg_idle",
        type: "idle",
        outcome: "failed",
        error: { type: "unknown", message: "Agent not found: build" },
        time: { created: 4 },
      }),
    ]
    expect(ids(ChatState.visibleMessages(failed, [steer]))).toEqual(["msg_3", "msg_idle"])
  })
})

test("selects user history strictly before the revert boundary", () => {
  const loaded = Hydrate.messages(
    Hydrate.info(ChatState.empty, [Fixture.session(sessionID)]),
    sessionID,
    Fixture.page(
      [
        Fixture.user("msg_a", 1),
        assistant("msg_2", 2),
        Fixture.user("msg_b", 3),
        Fixture.user("msg_c", 4),
      ].toReversed(),
    ),
  )
  expect(ChatState.userMessages(loaded, sessionID).map((message): string => message.id)).toEqual([
    "msg_a",
    "msg_b",
    "msg_c",
  ])
  expect(ChatState.visibleUserMessages(loaded, sessionID).map((message): string => message.id)).toEqual([
    "msg_a",
    "msg_b",
    "msg_c",
  ])
  const reverted = Hydrate.revert(loaded, sessionID, { messageID: SessionMessage.ID.make("msg_b") })
  expect(ChatState.visibleUserMessages(reverted, sessionID).map((message): string => message.id)).toEqual(["msg_a"])
  expect(ChatState.visible(reverted, sessionID).map((message): string => message.id)).toEqual(["msg_a", "msg_2"])
})

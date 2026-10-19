import { describe, expect, test } from "bun:test"
import { TimelineRow } from "@ren/chat"
import { Timeline } from "./timeline.js"

const rows = [
  new TimelineRow.UserMessage({ userMessageID: "msg_a" }),
  new TimelineRow.AssistantPart({
    userMessageID: "msg_a",
    group: { key: "prt_1", type: "part", ref: { messageID: "msg_b", partID: "prt_1" } },
    previousAssistantPart: false,
  }),
  new TimelineRow.Notice({ userMessageID: "msg_a", messageID: "msg_c" }),
]

describe("rowFor", () => {
  test("finds the row that shows a linked message", () => {
    expect(Timeline.rowFor(rows, "msg_a")).toBe("user-message:msg_a")
    expect(Timeline.rowFor(rows, "msg_b")).toBe("assistant-part:part:prt_1")
    expect(Timeline.rowFor(rows, "msg_c")).toBe("notice:msg_c")
  })

  test("finds nothing for a message that is not loaded", () => {
    expect(Timeline.rowFor(rows, "msg_z")).toBeUndefined()
  })
})

describe("rowForPart", () => {
  const grouped = [
    ...rows,
    new TimelineRow.AssistantPart({
      userMessageID: "msg_a",
      group: {
        key: "context:msg_d:call_1",
        type: "context",
        refs: [
          { messageID: "msg_d", partID: "call_1" },
          { messageID: "msg_d", partID: "call_2" },
        ],
      },
      previousAssistantPart: true,
    }),
    new TimelineRow.AssistantPart({
      userMessageID: "msg_a",
      group: { key: "call_2", type: "part", ref: { messageID: "msg_e", partID: "call_2" } },
      previousAssistantPart: true,
    }),
  ]

  test("finds the last row that holds a part, alone or in a group", () => {
    expect(Timeline.rowForPart(grouped, (reference) => reference.partID === "call_1")).toBe(
      "assistant-part:context:context:msg_d:call_1",
    )
    expect(Timeline.rowForPart(grouped, (reference) => reference.partID === "call_2")).toBe(
      "assistant-part:part:call_2",
    )
    expect(Timeline.rowForPart(grouped, (reference) => reference.partID === "call_9")).toBeUndefined()
  })
})

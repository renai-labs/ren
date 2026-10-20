import { describe, expect, test } from "bun:test"
import { QueueRewrite } from "../src/queue-rewrite.js"
import { Fixture } from "./lib/fixture.js"

const queued = (id: string, fields: object = {}, delivery = "queue") =>
  Fixture.inbox({
    id,
    sessionID: Fixture.sessionID,
    time: { created: 1 },
    type: "user",
    delivery,
    payload: { text: id, sender: { userId: "user_1" }, ...fields },
  })

const a = queued("msg_a")
const b = queued("msg_b")
const c = queued("msg_c")
const pending = [a, b, c]

const sender = { userId: "user_1" }

describe("QueueRewrite.plan", () => {
  test("re-admits the changed suffix in its new order and withdraws the originals", () => {
    expect(QueueRewrite.plan(pending, Fixture.ids("msg_a", "msg_c", "msg_b"), sender)).toMatchObject({
      _tag: "Rewrite",
      readmit: [
        { id: c.id, payload: { text: "msg_c" } },
        { id: b.id, payload: { text: "msg_b" } },
      ],
      cancel: Fixture.ids("msg_b", "msg_c"),
    })
  })

  test("a drop at the same index does nothing", () => {
    expect(QueueRewrite.plan(pending, Fixture.ids("msg_a", "msg_b", "msg_c"), sender)).toEqual({ _tag: "Unchanged" })
  })

  test("steered input stays where it is", () => {
    expect(
      QueueRewrite.plan([queued("msg_steer", {}, "steer"), ...pending], Fixture.ids("msg_b", "msg_a", "msg_c"), sender),
    ).toMatchObject({
      _tag: "Rewrite",
      cancel: Fixture.ids("msg_a", "msg_b", "msg_c"),
    })
  })

  test.each([
    [
      "queued control items block reordering",
      [
        ...pending,
        Fixture.inbox({
          id: "msg_compact",
          sessionID: Fixture.sessionID,
          time: { created: 2 },
          type: "compaction",
          delivery: "queue",
          payload: {},
        }),
      ],
      Fixture.ids("msg_b", "msg_a", "msg_c"),
      "control",
    ],
    ["queued prompts changed before reordering", pending, Fixture.ids("msg_b", "msg_a"), "changed"],
    [
      "another member's prompt would be sent again as yours",
      [a, queued("msg_b", { sender: { userId: "user_2" } })],
      Fixture.ids("msg_b", "msg_a"),
      "member",
    ],
    [
      "a prompt with files cannot be sent again yet",
      [queued("msg_a", { files: [{ data: "aGk=", mime: "text/plain", source: { type: "inline" } }] }), b],
      Fixture.ids("msg_b", "msg_a"),
      "files",
    ],
  ] as const)("refuses when %s", (_name, items, order, reason) => {
    expect(QueueRewrite.plan(items, order, sender)).toEqual({ _tag: "Refused", reason })
  })
})

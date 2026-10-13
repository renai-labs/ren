import { describe, expect, test } from "bun:test"
import { Reconcile } from "../src/reconcile.js"

const parkAfterMs = 600_000

const work = (fields: Partial<Reconcile.Session>) =>
  Reconcile.work({ active: false, inbox: [], unfinished: false, askedMs: undefined, ...fields }, parkAfterMs)

const user = (id: string): Reconcile.Item => ({ id, type: "user" })

describe("reconcile work", () => {
  test("a stopped session with an empty inbox and a finished last turn is idle", () => {
    expect(work({})).toEqual({ _tag: "Idle" })
  })

  test("an active session is running, whatever its inbox and last turn", () => {
    expect(work({ active: true, inbox: [user("msg_1")], unfinished: true })).toEqual({ _tag: "Running" })
  })

  test("a stopped session with a prompt in its inbox is queued with its first prompt", () => {
    expect(work({ inbox: [user("msg_1"), user("msg_2")] })).toEqual({ _tag: "Queued", item: user("msg_1") })
  })

  test("synthetic, compaction and move items wait for the next prompt: an inbox of only those counts as empty", () => {
    const items: ReadonlyArray<Reconcile.Item> = [
      { id: "msg_1", type: "synthetic" },
      { id: "msg_2", type: "compaction" },
      { id: "msg_3", type: "move" },
    ]
    expect([...items.map((item) => work({ inbox: [item] })), work({ inbox: items })]).toEqual(
      Array.from({ length: 4 }, () => ({ _tag: "Idle" })),
    )
  })

  test("items that wait for the next prompt are skipped and the first prompt is queued", () => {
    expect(
      work({
        inbox: [{ id: "msg_1", type: "synthetic" }, { id: "msg_2", type: "move" }, user("msg_3"), user("msg_4")],
      }),
    ).toEqual({ _tag: "Queued", item: user("msg_3") })
  })

  test("items that wait for the next prompt do not hide an unfinished last turn", () => {
    expect(work({ inbox: [{ id: "msg_1", type: "synthetic" }], unfinished: true })).toEqual({ _tag: "Resuming" })
  })

  test("a stopped session whose last turn is unfinished is resuming", () => {
    expect(work({ unfinished: true })).toEqual({ _tag: "Resuming" })
  })

  test("a session waiting on a question is running until the question has waited the park time", () => {
    expect([0, parkAfterMs - 1].map((askedMs) => work({ active: true, askedMs }))).toEqual([
      { _tag: "Running" },
      { _tag: "Running" },
    ])
  })

  test("a question that has waited the park time or longer is unanswered", () => {
    expect([parkAfterMs, parkAfterMs * 10].map((askedMs) => work({ active: true, askedMs }))).toEqual([
      { _tag: "Unanswered" },
      { _tag: "Unanswered" },
    ])
  })

  test("input in the inbox wins over an unfinished last turn", () => {
    expect(work({ inbox: [user("msg_1")], unfinished: true })).toEqual({ _tag: "Queued", item: user("msg_1") })
  })
})

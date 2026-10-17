import { expect, test } from "bun:test"
import { Reconcile } from "../src/reconcile.js"

const parkAfterMs = 600_000

const user = (id: string): Reconcile.Item => ({ id, type: "user" })

const synthetic = (id: string): Reconcile.Item => ({ id, type: "synthetic" })

test.each<[string, Partial<Reconcile.Snapshot>, Reconcile.Work]>([
  [
    "an active session is running, whatever its inbox and last turn",
    { active: true, inbox: [user("msg_1")], unfinished: true },
    { _tag: "Running" },
  ],
  [
    "a question that has waited the park time is unanswered",
    { active: true, questionAgeMs: parkAfterMs },
    { _tag: "Unanswered" },
  ],
  [
    "a question one millisecond short of the park time is running",
    { active: true, questionAgeMs: parkAfterMs - 1 },
    { _tag: "Running" },
  ],
  [
    "a stopped session queues its first prompt, skipping items that wait for the next prompt",
    { inbox: [synthetic("msg_1"), user("msg_2"), user("msg_3")] },
    { _tag: "Queued", item: user("msg_2") },
  ],
  [
    "items that wait for the next prompt do not hide an unfinished last turn",
    { inbox: [synthetic("msg_1")], unfinished: true },
    { _tag: "Resuming" },
  ],
  [
    "a prompt in the inbox wins over an unfinished last turn",
    { inbox: [user("msg_1")], unfinished: true },
    { _tag: "Queued", item: user("msg_1") },
  ],
])("%s", (_name, snapshot, expected) => {
  expect(
    Reconcile.work({ active: false, inbox: [], unfinished: false, questionAgeMs: undefined, ...snapshot }, parkAfterMs),
  ).toEqual(expected)
})

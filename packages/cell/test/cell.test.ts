import { describe, test } from "bun:test"

describe("cell contract", () => {
  describe("tokens", () => {
    test.todo(
      "answers 401 to an expired, tampered, malformed or unknown-key token, with the same body for each",
      () => {},
    )
    test.todo("accepts the token as the password of Basic auth, with any user name", () => {})
    test.todo("answers 401 to a valid token sent as Bearer or as auth_token", () => {})
    test.todo("a client token creates a session through the client surface and reads it back", () => {})
    test.todo("a server token reaches the client surface too", () => {})
  })

  describe("routing", () => {
    test.todo("two session ids reach two separate cells: a session created in one is not in the other", () => {})
    test.todo("one session id reaches the same cell on every request", () => {})
    test.todo("other /cell/ paths answer 404 and never reach OpenCode", () => {})
  })

  describe("client surface", () => {
    test.todo("forwards the method, path, query and body of any route", () => {})
    test.todo("passes OpenCode's status codes and bodies through unchanged, including 404", () => {})
    test.todo("streams events to the client as they happen", () => {})
    test.todo("the OpenCode client attaches with the token as its password, the way the TUI does", () => {})
  })

  describe("/cell/state", () => {
    test.todo("needs a server token: 401 without one and 403 with a client token", () => {})
    test.todo("a fresh cell reports the harness closed, no leases, no alarm and no wait", () => {})
    test.todo("never opens the harness, sets no alarm and holds no lease", () => {})
  })

  describe("open and close", () => {
    test.todo("a client request to a fresh cell sets the alarm before it reaches OpenCode", () => {})
    test.todo("a request leaves an alarm that is already set where it is", () => {})
    test.todo("the first client request opens the harness", () => {})
    test.todo("concurrent first requests to a fresh cell all succeed", () => {})
    test.todo("an open event stream holds a lease until the client disconnects", () => {})
    test.todo("the alarm after the interval reconciles an idle harness by closing it and setting no alarm", () => {})
    test.todo("an open event stream keeps the harness open across alarms", () => {})
    test.todo(
      "a request after the idle close opens the harness again and sees the same sessions and messages",
      () => {},
    )
  })

  describe("reconcile", () => {
    test.todo(
      "a running turn keeps the harness open and shows a wait, and the harness closes after the turn ends",
      () => {},
    )
    test.todo(
      "a wait that outlives its budget ends and the alarm is set again, while the turn runs to the end",
      () => {},
    )
    test.todo("an alarm during an earlier wait starts no second wait", () => {})
    test.todo("a running child session keeps the harness open while the root session is idle", () => {})
    test.todo(
      "a question answered within the park time continues the turn with the answer as the tool result",
      () => {},
    )
    test.todo(
      "a question unanswered for the park time is parked: the turn is interrupted, the harness closes and no alarm is set",
      () => {},
    )
    test.todo("an answer sent as a message after parking reopens the cell and the turn continues", () => {})
    test.todo("a prompt queued behind a running turn runs after it with no client request", () => {})
    test.todo("a turn that fails on a model error OpenCode does not retry leaves the cell idle and closed", () => {})
    test.todo("a stream cut mid-way without a crash is continued, and the cell ends idle and closed", () => {})
    test.todo("a turn that receives malformed model data leaves the cell idle and closed", () => {})
  })
})

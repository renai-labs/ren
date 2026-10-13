import { describe, test } from "bun:test"

describe("OpenCode in a cell", () => {
  describe("the host", () => {
    test.todo("serves OpenCode's HTTP API and reports the pinned version from /api/info", () => {})
    test.todo("registers a plugin that sees each turn", () => {})
    test.todo("puts every session in /workspace", () => {})
  })

  describe("idle marker", () => {
    test.todo("a new session with no turns has no idle marker yet", () => {})
    test.todo("a running turn has no idle marker", () => {})
    test.todo("a turn that succeeds ends in an idle marker with the outcome succeeded", () => {})
    test.todo("a turn that fails on a model error ends in an idle marker with the outcome failed", () => {})
    test.todo("a turn cut off mid-stream ends in an idle marker with the outcome failed", () => {})
    test.todo("an interrupted turn ends in an idle marker", () => {})
  })

  describe("reads", () => {
    test.todo("sessions.active lists a running session and drops it once the turn ends", () => {})
    test.todo("inbox.list shows a prompt queued behind a running turn, with its id and delivery", () => {})
    test.todo("a queued prompt stays in the inbox until the session that runs it is active", () => {})
    test.todo("a child session shows in the reads like a root session", () => {})
  })

  describe("inbox re-send", () => {
    test.todo(
      "re-sending a queued prompt by its id with resume: true starts the session and admits nothing twice",
      () => {},
    )
    test.todo("re-sending a prompt that is already a user message runs no second turn", () => {})
  })

  describe("waiting", () => {
    test.todo("a wait on a running turn returns when the turn ends", () => {})
    test.todo("cancelling a wait leaves the turn running to the end", () => {})
  })

  describe("close and reopen", () => {
    test.todo("sessions, messages and instruction entries survive closing the host and opening a new one", () => {})
    test.todo("a queued prompt survives a close and runs after the reopen", () => {})
    test.todo("an open event stream ends when the host closes", () => {})
  })

  describe("new sessions", () => {
    test.todo("the first prompt of a new session makes one title call besides the turn", () => {})
    test.todo("later prompts make no title call", () => {})
  })

  describe("a pending question", () => {
    test.todo("reports whether a session waiting on a question counts as active", () => {})
    test.todo("the question survives a close and reopen and can be answered after it", () => {})
    test.todo("answering the question after a reopen continues the turn", () => {})
  })

  describe("after a crash", () => {
    test.todo("opening the host resumes a cut-off turn with the restart message and a new model call", () => {})
    test.todo("the cut-off turn leaves an empty assistant message", () => {})
    test.todo("a turn that finished before the crash is not run again", () => {})
  })
})

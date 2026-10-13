import { describe, test } from "bun:test"

describe("crash recovery", () => {
  test.todo("killed after a prompt is queued behind a running turn: both turns finish with no client request", () => {})
  test.todo(
    "killed mid-stream: the turn resumes with the restart message and finishes with no client request",
    () => {},
  )
  test.todo("killed during a wait that outlived its budget: the turn finishes with no client request", () => {})
  test.todo("killed twice in a row, the second time during the resumed turn: the turn still finishes", () => {})
  test.todo("killed while reconcile opens OpenCode: the next alarm resumes the turn", () => {})
  test.todo("killed during an idle close: the cell stays closed and makes no model call", () => {})
  test.todo("killed just after a turn ends: no second turn runs", () => {})
  test.todo("killed with nothing running: the cell restarts with no alarm and makes no model call", () => {})
  test.todo(
    "killed mid-stream with the model down when the turn resumes: the turn fails and the cell ends idle and closed",
    () => {},
  )
  test.todo("after every recovery, /cell/state shows the harness closed after the alarm interval", () => {})
})

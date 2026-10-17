import { describe, test } from "bun:test"

describe("OpenCodeSync", () => {
  test.todo(
    "a long session with tool calls, a subagent, a retry, and a shell command is equal in SQLite and in Postgres",
    () => {},
  )
  test.todo("a revert while sync is late deletes the reverted messages in Postgres", () => {})
  test.todo("a second step with no change sends no request except checkpoints", () => {})
  test.todo("a claim that changes only time_suspended makes Ren show busy. A release makes Ren show idle", () => {})
  test.todo(
    "a step that fails at the start of the upload, at each batch, or at the commit, then runs again, gives an equal result. One case for each request",
    () => {},
  )
  test.todo(
    "Ren applies the start of the upload, a batch, or the commit, and the reply is lost. The next step gives an equal result. After a lost commit reply, the next step does no pass",
    () => {},
  )
  test.todo(
    "a message that OpenCode writes between the read of E and the read of L is in Postgres after the next step",
    () => {},
  )
  test.todo("a title change during a pass is in Postgres after the next step", () => {})
  test.todo(
    "a session that OpenCode deletes during a pass does not commit, and the next step does not send it",
    () => {},
  )
  test.todo(
    "a row larger than O2 stops the pass with no commit, logs the row, and increases the counter. The step is not drained. The other sessions of the step sync",
    () => {},
  )
  test.todo("with no OpenCode tables, the step is drained and sends no request", () => {})
  test.todo("a missing column stops the step before any request and logs an error. Ren gets no rows", () => {})
  test.todo(
    "a busy session gets no second pass before the O4 limit. The pass after the turn ends has no delay. After a restart, the first step does a pass at once. Use TestClock",
    () => {},
  )
  test.todo(
    "Ren refuses an unknown root. The host logs it one time and does not send it or its children again in that process",
    () => {},
  )
  test.todo(
    "Ren refuses a child because the pass of its parent failed. The next step sends the child again, and Ren adopts it",
    () => {},
  )
  test.todo(
    "one step syncs a root, a child, and a grandchild that Ren does not have, with each parent before its children",
    () => {},
  )
  test.todo(
    "a step does not run while the restore flag is set. A step and a restore never run at the same time",
    () => {},
  )
  test.todo(
    "a host token that expires during a pass stops the pass. The next step with a new token gives an equal result",
    () => {},
  )
  test.todo(
    "after the deadline of a step, a pass that started finishes, no new pass starts, and the step is not drained",
    () => {},
  )
})

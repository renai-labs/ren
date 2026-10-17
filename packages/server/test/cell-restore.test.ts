import { describe, test } from "bun:test"

describe("cell restore", () => {
  test.todo(
    "delete the cell storage. start restores the session and its child. The next message continues the session. Postgres has the new seq values and no unsettled rows",
    () => {},
  )
  test.todo(
    "stop Ren during restore. start fails, and the cell has no session. After Ren starts again, the retry of BrainHost restores the session",
    () => {},
  )
  test.todo(
    "kill celld after the parent import and before the child import. The next start imports only the child",
    () => {},
  )
  test.todo("a request of an upload that the old cell started before the restore gets StaleUploadError", () => {})
  test.todo(
    "the root has no opencode_session row, and a child has one. start makes the root as today and imports the child",
    () => {},
  )
  test.todo(
    "restore skips a child whose parent it cannot restore, logs an error, and restores the other sessions",
    () => {},
  )
  test.todo(
    "send to the lost session restores it through start with start_input. A message ID that the cell accepted before the loss is not submitted again",
    () => {},
  )
  test.todo(
    "a session with an environment restores with its workspace, and its next tool call runs on the environment",
    () => {},
  )
  test.todo(
    "a session that was busy when the storage was lost restores as idle. After the next pass, Ren shows idle",
    () => {},
  )
  test.todo("a cell with no Ren URL makes the session as today and does not call restore", () => {})
})

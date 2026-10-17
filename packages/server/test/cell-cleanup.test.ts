import { describe, test } from "bun:test"

describe("cell cleanup", () => {
  test.todo("cleanup, then send a message: start restores the session, and the history is complete", () => {})
  test.todo("a second cleanup answers absent", () => {})
  test.todo("cleanup with an open event stream ends the stream", () => {})
  test.todo("cleanup while Ren is down answers 503 and deletes nothing", () => {})
  test.todo("cleanup with a row larger than O2 answers 503 and deletes nothing", () => {})
  test.todo("kill celld during cleanup. A repeated cleanup completes", () => {})
  test.todo("a request that arrives during cleanup gets 503", () => {})
  test.todo("after cleanup, the cell has no alarm, no credentials, and no OpenCode tables", () => {})
})

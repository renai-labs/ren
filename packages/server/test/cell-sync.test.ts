import { describe, test } from "bun:test"

describe("cell sync", () => {
  test.todo("a turn, then flush: Postgres is equal to the cell", () => {})
  test.todo(
    "stop the Ren server during a turn. Start it after the turn. Postgres becomes equal to the cell with no client request",
    () => {},
  )
  test.todo(
    "Ren cannot reach Postgres during a turn. After Postgres is back, Postgres becomes equal to the cell with no client request",
    () => {},
  )
  test.todo("kill celld during a turn. Start it again. Postgres becomes equal to the cell", () => {})
  test.todo(
    "kill celld during a pass. Start it again. Postgres becomes equal to the cell, and a late batch of the old upload gets StaleUploadError",
    () => {},
  )
  test.todo("let the host token expire while Ren is down. The next call from Ren completes the sync", () => {})
  test.todo("a cell with no Ren URL runs as today and sends no sync request", () => {})
})

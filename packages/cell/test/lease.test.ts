import { describe, test } from "bun:test"

describe("host leases", () => {
  test.todo("the first lease opens the host and later leases reuse it", () => {})
  test.todo("leases taken while the host is opening share one open", () => {})
  test.todo("a failed open is not kept: every waiting lease fails and the next lease opens again", () => {})
  test.todo("releasing a lease lowers the count, and releasing it twice changes nothing", () => {})
  test.todo("a lease is released when the work it guards fails or is interrupted", () => {})
  test.todo("close waits until no lease is held", () => {})
  test.todo("a lease taken while the host closes waits for the close, then opens a new host", () => {})
})

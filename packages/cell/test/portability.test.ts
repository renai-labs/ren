import { describe, expect, test } from "bun:test"
import assert from "assert/strict"

const config: unknown = Bun.JSONC.parse(await Bun.file(new URL("../wrangler.jsonc", import.meta.url)).text())
assert.ok(typeof config === "object" && config !== null)

describe("shared Wrangler config", () => {
  test("wrangler.jsonc contains only celld-supported top-level keys", () => {
    const allowed = new Set([
      "name",
      "main",
      "compatibility_date",
      "compatibility_flags",
      "durable_objects",
      "migrations",
      "vars",
      "define",
      "rules",
    ])
    expect(Object.keys(config).filter((key) => !allowed.has(key))).toEqual([])
  })
  test("the worker name remains ren-cell-opencode and SESSION_CELL binds to SessionCell", () => {
    expect(config).toMatchObject({ name: "ren-cell-opencode", main: "src/worker.ts" })
    assert.ok("durable_objects" in config)
    expect(config.durable_objects).toEqual({ bindings: [{ name: "SESSION_CELL", class_name: "SessionCell" }] })
  })
  test("migrations contain only tag and new_sqlite_classes and create SessionCell", () => {
    assert.ok("migrations" in config)
    expect(config.migrations).toEqual([{ tag: "v1", new_sqlite_classes: ["SessionCell"] }])
  })
  test("compatibility flags stay within the shared subset and include OpenCode's required flags", () => {
    assert.ok("compatibility_flags" in config)
    expect(config.compatibility_flags).toEqual(["nodejs_compat", "delete_all_deletes_alarm"])
  })
})

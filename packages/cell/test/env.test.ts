import { describe, expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { Env } from "../src/env.js"
import { TestToken } from "./lib/token.js"

const decode = (vars: Record<string, string>) => Schema.decodeUnknownSync(Env.Vars)({ ...TestToken.vars, ...vars })

const decodes = (vars: Record<string, string>) =>
  Option.isSome(Schema.decodeUnknownOption(Env.Vars)({ ...TestToken.vars, ...vars }))

describe("worker env", () => {
  test("passes the OpenCode config through as text and defaults it to an empty object", () => {
    expect(
      [decode({}), decode({ OPENCODE_CONFIG: '{"model":"stub/stub-model"}' })].map((vars) => vars.OPENCODE_CONFIG),
    ).toEqual(["{}", '{"model":"stub/stub-model"}'])
  })

  test("defaults the alarm interval to 30 s, the wait budget to 10 min and the park time to 10 min", () => {
    expect(decode({})).toMatchObject({ ALARM_INTERVAL_MS: 30_000, WAIT_BUDGET_MS: 600_000, PARK_AFTER_MS: 600_000 })
  })

  test("reads the timings from worker variables in milliseconds", () => {
    expect(decode({ ALARM_INTERVAL_MS: "1000", WAIT_BUDGET_MS: "3000", PARK_AFTER_MS: "2000" })).toMatchObject({
      ALARM_INTERVAL_MS: 1000,
      WAIT_BUDGET_MS: 3000,
      PARK_AFTER_MS: 2000,
    })
  })

  test("rejects a timing that is not a positive whole number", () => {
    const invalid = ["0", "-1", "1.5", "soon", "", "Infinity"].flatMap((value) => [
      { ALARM_INTERVAL_MS: value },
      { ALARM_INTERVAL_MS: "1", WAIT_BUDGET_MS: value },
      { PARK_AFTER_MS: value },
    ])
    expect(invalid.filter(decodes)).toEqual([])
  })

  test("decodes the signing key list with an id per key", () => {
    expect(decode({}).CELL_KEYS).toEqual(TestToken.keys)
  })

  test("rejects a missing, empty or unreadable key list", () => {
    expect(Option.isSome(Schema.decodeUnknownOption(Env.Vars)({}))).toBe(false)
    expect([{ CELL_KEYS: "[]" }, { CELL_KEYS: "active:secret" }].filter(decodes)).toEqual([])
  })

  test("rejects two keys with the same id", () => {
    const keys = [TestToken.keys[0], { ...TestToken.keys[1], id: TestToken.keys[0].id }]
    expect(decodes({ CELL_KEYS: JSON.stringify(keys) })).toBe(false)
  })

  test("rejects a key shorter than 32 characters", () => {
    expect(decodes({ CELL_KEYS: JSON.stringify([{ id: "short", secret: "x".repeat(31) }]) })).toBe(false)
    expect(decodes({ CELL_KEYS: JSON.stringify([{ id: "exact", secret: "x".repeat(32) }]) })).toBe(true)
  })
})

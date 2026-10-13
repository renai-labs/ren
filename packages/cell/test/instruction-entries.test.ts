import { describe, expect, test } from "bun:test"
import { InstructionEntries } from "../src/harness/opencode/instruction-entries.js"

const entries = (context: Record<string, unknown>) =>
  Object.entries(context).map((entry) => ({ key: entry[0], value: entry[1] }))

describe("instruction entry changes", () => {
  test("a key in the wanted context that the session lacks is put", () => {
    expect(InstructionEntries.changes([], { team: "Ren" })).toEqual({
      put: [{ key: "team", value: "Ren" }],
      remove: [],
    })
  })

  test("a key whose value changed is put with the new value", () => {
    expect(InstructionEntries.changes(entries({ team: "Ren" }), { team: "Ren AI" })).toEqual({
      put: [{ key: "team", value: "Ren AI" }],
      remove: [],
    })
  })

  test("a key whose value is unchanged is left alone, so it adds no system update", () => {
    expect(InstructionEntries.changes(entries({ team: "Ren", goal: "ship" }), { team: "Ren", goal: "ship" })).toEqual({
      put: [],
      remove: [],
    })
  })

  test("a value that is not the same string, such as JSON a client put, is replaced", () => {
    expect(
      InstructionEntries.changes(entries({ team: { name: "Ren" }, size: 3, flag: null }), {
        team: "Ren",
        size: "3",
        flag: "null",
      }),
    ).toEqual({
      put: [
        { key: "flag", value: "null" },
        { key: "size", value: "3" },
        { key: "team", value: "Ren" },
      ],
      remove: [],
    })
  })

  test("a key the session has that left the wanted context is removed", () => {
    expect(InstructionEntries.changes(entries({ team: "Ren", goal: "ship" }), { team: "Ren" })).toEqual({
      put: [],
      remove: ["goal"],
    })
  })

  test("the wanted context is the session's whole set of entries: one a client added is removed too", () => {
    expect(InstructionEntries.changes(entries({ team: "Ren", note: { by: "tui" } }), { team: "Ren" })).toEqual({
      put: [],
      remove: ["note"],
    })
  })

  test("puts and removes come in key order, so a repeated start applies the same changes in the same order", () => {
    expect(
      InstructionEntries.changes(entries({ zeta: "1", alpha: "1", mid: "1" }), { yak: "2", bee: "2", kiwi: "2" }),
    ).toEqual({
      put: [
        { key: "bee", value: "2" },
        { key: "kiwi", value: "2" },
        { key: "yak", value: "2" },
      ],
      remove: ["alpha", "mid", "zeta"],
    })
  })

  test("an empty wanted context removes every entry and puts nothing", () => {
    expect(InstructionEntries.changes(entries({ team: "Ren", goal: "ship" }), {})).toEqual({
      put: [],
      remove: ["goal", "team"],
    })
  })

  test("no entries and an empty wanted context change nothing", () => {
    expect(InstructionEntries.changes([], {})).toEqual({ put: [], remove: [] })
  })
})

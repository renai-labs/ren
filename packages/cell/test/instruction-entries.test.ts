import { expect, test } from "bun:test"
import { InstructionEntries } from "../src/harness/opencode/instruction-entries.js"

test("creates missing entries", () => {
  expect(InstructionEntries.changes([], { team: "Ren" })).toEqual({
    put: [{ key: "team", value: "Ren" }],
    remove: [],
  })
})

test("updates changed entries", () => {
  expect(InstructionEntries.changes([{ key: "team", value: "Ren" }], { team: "Ren AI" })).toEqual({
    put: [{ key: "team", value: "Ren AI" }],
    remove: [],
  })
})

test("removes entries absent from the wanted set", () => {
  expect(InstructionEntries.changes([{ key: "team", value: "Ren" }], {})).toEqual({ put: [], remove: ["team"] })
})

test("leaves unchanged entries alone", () => {
  expect(InstructionEntries.changes([{ key: "team", value: "Ren" }], { team: "Ren" })).toEqual({ put: [], remove: [] })
})

import { expect, test } from "bun:test"
import { Option, Schema } from "effect"
import { ProcessEvent } from "../src/executor-api.js"

const decode = Schema.decodeUnknownOption(ProcessEvent)

test("decodes an exit with a code or with a signal", () => {
  expect(decode({ type: "exit", exitCode: 3, signal: null })).toEqual(
    Option.some({ type: "exit", exitCode: 3, signal: null }),
  )
  expect(decode({ type: "exit", exitCode: null, signal: "SIGTERM" })).toEqual(
    Option.some({ type: "exit", exitCode: null, signal: "SIGTERM" }),
  )
})

test("refuses an exit with neither a code nor a signal, or with both", () => {
  expect(decode({ type: "exit", exitCode: null, signal: null })).toEqual(Option.none())
  expect(decode({ type: "exit", exitCode: 0, signal: "SIGTERM" })).toEqual(Option.none())
})

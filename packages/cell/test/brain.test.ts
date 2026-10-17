import { expect, test } from "bun:test"
import { BrainApi } from "@ren/brain-api/brain-api"
import { Session } from "@ren/schema/session"
import { Exit, Schema } from "effect"
import { HttpApi } from "effect/http-api"
import { Brain } from "../src/brain.js"

test("every Brain API path is under the prefix the worker keeps for server tokens", () => {
  const paths: Array<string> = []
  HttpApi.reflect(BrainApi, { onGroup: () => {}, onEndpoint: (options) => paths.push(options.endpoint.path) })
  expect(paths.length).toBeGreaterThan(0)
  expect(paths.filter((path) => !Brain.owns(path))).toEqual([])
})

const message = (files: ReadonlyArray<{ readonly url: string }>) => ({
  messageId: Session.MessageID.create(),
  prompt: { text: "look", files },
  sender: { userId: "user_1" },
})

const sessionId = Session.ID.create()

const send = Schema.decodeUnknownExit(Session.SendInput)

const start = Schema.decodeUnknownExit(Session.StartInput)

test.each<[string, (input: unknown) => Exit.Exit<unknown, unknown>, unknown]>([
  ["a file that is not a data URL", send, { sessionId, ...message([{ url: "https://example.com/a.png" }]) }],
  [
    "a file over 10 MB",
    send,
    { sessionId, ...message([{ url: `data:text/plain,${"a".repeat(Session.maxFileBytes + 1)}` }]) },
  ],
  [
    "an instruction over 256 KiB",
    start,
    { sessionId, harness: "opencode", instructions: { team: "a".repeat(256 * 1024) } },
  ],
  [
    "an initial message with a file over 10 MB",
    start,
    {
      sessionId,
      harness: "opencode",
      initialMessage: message([{ url: `data:text/plain,${"a".repeat(Session.maxFileBytes + 1)}` }]),
    },
  ],
])("the Brain API refuses %s", (_name, decode, payload) => {
  expect(Exit.isFailure(decode(payload))).toBe(true)
})

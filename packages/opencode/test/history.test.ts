import { expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { History } from "../src/history.js"
import { Messages } from "./lib/messages.js"

const local = (message: SessionMessage.Info): History.Local => ({
  id: message.id,
  type: message.type,
  time: { created: 0, completed: 1 },
})

const own = (type: string): History.Local => ({
  id: SessionMessage.ID.create(),
  type,
  time: { created: 0, completed: 1 },
})

test("a local copy that streamed its own turns is not behind, though its assistant messages have other IDs than Ren's", () => {
  const asked = Messages.user(0, "hello")
  const ren = [
    asked,
    Messages.assistant(1, [Messages.text("one")]),
    Messages.assistant(2, [Messages.text("two")]),
    Messages.idle(3),
  ]
  expect(History.behind(ren, [local(asked), own("assistant"), own("idle")])).toBe(false)
})

test("a local copy is behind when Ren has a user or synthetic message after the last message they share, or a turn the copy has no answer of", () => {
  const asked = Messages.user(0, "hello")
  const answer = Messages.assistant(1, [Messages.text("hi")])
  const copy = [local(asked), local(answer)]
  expect(History.behind([asked, answer, Messages.user(2, "more")], copy)).toBe(true)
  expect(History.behind([asked, answer, Messages.synthetic(2, "a subagent's result")], copy)).toBe(true)
  expect(History.behind([asked, Messages.assistant(2, [Messages.text("hi")])], [local(asked)])).toBe(true)
  expect(History.behind([asked, answer], copy)).toBe(false)
})

test("a turn still running on Ren does not make a copy behind, because the import would drop it", () => {
  const asked = Messages.user(0, "hello")
  const running = Messages.assistant(1, [Messages.text("hi")], { time: { created: Messages.user(1, "").time.created } })
  expect(History.behind([asked, running], [local(asked)])).toBe(false)
})

test("unsent messages are the local user messages after the last answer that Ren does not have", () => {
  const asked = Messages.user(0, "hello")
  const answer = own("assistant")
  const later = own("user")
  const failed: History.Local = { ...own("assistant"), error: { message: "brain unreachable" } }
  expect(History.unsent([asked], [local(asked), answer, later, failed]).map((message) => message.id)).toEqual([
    later.id,
  ])
  expect(History.unsent([asked], [local(asked), answer])).toEqual([])
})

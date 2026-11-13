import { describe, expect, test } from "bun:test"
import { SessionMessage } from "@ren/schema/session/message"
import { Session } from "@ren/schema/session"
import { Composer } from "../src/composer.js"
import { Fixture } from "./lib/fixture.js"

const quote = { id: "q1", text: "up 12%", source: "Ren's reply" }

describe("Composer request", () => {
  test("a draft with quotes sends your words, then each formatted quote, and keeps the words and quotes as presentation", () => {
    const request = Composer.request({ text: "Why?", pasted: [], quotes: [quote] })
    expect(request.text).toBe("Why?\nThe user quoted the following from Ren's reply:\n> up 12%")
    expect(request.presentation).toEqual({
      displayText: "Why?",
      comments: [{ type: "quote", text: "up 12%", source: "Ren's reply" }],
    })
  })

  test("a draft with quotes and no words is not blank", () => {
    const draft = { text: "", pasted: [], quotes: [quote] }
    expect(Composer.isBlank(draft)).toBe(false)
    expect(Composer.request(draft).text).toBe("The user quoted the following from Ren's reply:\n> up 12%")
    expect(Composer.isBlank(Composer.withoutQuote(draft, "q1"))).toBe(true)
  })

  test("a draft without quotes sends its words and no presentation", () => {
    expect(Composer.request({ text: "Hi", pasted: [] })).toEqual({ text: "Hi" })
  })

  test("a failed send restores the quotes, and a new draft keeps them after the new words", () => {
    const sent = { text: "Why?", pasted: [], quotes: [quote] }
    const id = SessionMessage.ID.make("msg_1")
    expect(Composer.restore(Composer.empty, sent, id).quotes).toEqual([quote])
    expect(Composer.restore({ text: "More", pasted: [] }, sent, id).quotes).toEqual([quote])
  })

  test("a submission carries the presentation and keeps the quotes in the draft it can restore", () => {
    const submission = Composer.submission(
      { text: "Why?", pasted: [], quotes: [quote] },
      { working: false, behavior: "steer", alternative: false, queue: false, current: undefined },
    )
    expect(submission?.presentation?.comments).toHaveLength(1)
    expect(submission?.sent.quotes).toEqual([quote])
    expect(submission?.next).toEqual(Composer.empty)
  })

  test("removing an unsent quote restores its chip beside the current draft instead of the model instructions", () => {
    const request = Composer.request({ text: "Why?", pasted: [], quotes: [quote] })
    const recalled = Composer.recall({ text: "More", pasted: [] }, request)
    expect(recalled.text).toBe("More\n\nWhy?")
    expect(recalled.quotes).toMatchObject([{ text: quote.text, source: quote.source }])
    expect(Composer.request(recalled).presentation?.comments).toEqual(request.presentation?.comments)
  })

  test("a queued quote shows the person's words and quoted text, not the model instructions", () => {
    const request = Composer.request({ text: "Why?", pasted: [], quotes: [quote] })
    const queued = Composer.queued([
      {
        id: SessionMessage.ID.make("msg_quote"),
        sessionID: Session.ID.make("ses_quote"),
        type: "user",
        delivery: "queue",
        time: { created: Fixture.at(1) },
        payload: request,
      },
    ])
    expect(queued[0]?.text).toBe("Why?\n\n> up 12%")
  })
})

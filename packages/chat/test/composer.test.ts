// oxlint-disable typescript/no-misused-spread -- drafts are plain readonly structs built inline for each case
import { describe, expect, test } from "bun:test"
import { Session } from "@ren/schema/session"
import type { SessionInbox } from "@ren/schema/session-inbox"
import { SessionMessage } from "@ren/schema/session-message"
import type { SessionModel } from "@ren/schema/session-model"
import { DateTime } from "effect"
import { Composer } from "../src/composer.js"

const draft = (text: string, pasted: ReadonlyArray<string> = []): Composer.Draft => ({
  text,
  pasted: pasted.map((item, index) => ({ id: `p${index}`, text: item })),
})

const created = { created: DateTime.makeUnsafe(1) }

const inbox = (
  id: string,
  delivery: SessionInbox.Delivery,
  type: "user" | "synthetic" | "compaction" = "user",
): SessionInbox.Info => {
  const base = { id: SessionMessage.ID.make(id), sessionID: Session.ID.make("ses_1"), time: created }
  if (type === "compaction") return { ...base, type, delivery, payload: {} }
  if (type === "synthetic") return { ...base, type, delivery, payload: { text: id } }
  return { ...base, type, delivery, payload: { text: `${id} text` } }
}

describe("Composer draft", () => {
  test("decodes a stored draft and falls back to an empty draft when the value is missing or corrupt", () => {
    const stored = Composer.encode(draft("Plan the launch", ["log"]))
    expect(stored).toBeDefined()
    expect(Composer.decode(stored)).toEqual(draft("Plan the launch", ["log"]))
    expect(Composer.decode(undefined)).toEqual(Composer.empty)
    expect(Composer.decode("{not json")).toEqual(Composer.empty)
    expect(Composer.decode(JSON.stringify({ text: 4 }))).toEqual(Composer.empty)
  })

  test("stores nothing for a blank draft so the key can be removed", () => {
    expect(Composer.encode(draft("  \n"))).toBeUndefined()
    expect(Composer.encode({ ...draft(""), model: { id: "gpt", providerID: "openai" } })).toBeDefined()
  })

  test("joins the typed text and pasted blocks into one message, skipping blank pieces", () => {
    expect(Composer.message(draft("Summarise this", ["first block", "  ", "second block"]))).toBe(
      "Summarise this\n\nfirst block\n\nsecond block",
    )
    expect(Composer.message(draft("   ", ["only the block"]))).toBe("only the block")
    expect(Composer.isBlank(draft(" \n "))).toBe(true)
  })

  test("reuses the message ID of a failed send only while the message is unchanged", () => {
    const id = SessionMessage.ID.make("msg_retry")
    const failed = Composer.restore(Composer.empty, draft("Plan the launch"), id)
    expect(Composer.retryID(failed)).toBe(id)
    expect(Composer.retryID({ ...failed, text: "Plan the launch now" })).toBeUndefined()
  })

  test("restores an unsent draft only when the composer is untouched, otherwise keeps the new text after it", () => {
    const id = SessionMessage.ID.make("msg_retry")
    const restored = Composer.restore(draft("Follow-up", ["new block"]), draft("Plan the launch", ["log"]), id)
    expect(restored.text).toBe("Plan the launch\n\nFollow-up")
    expect(restored.pasted.map((item) => item.text)).toEqual(["log", "new block"])
    expect(Composer.retryID(restored)).toBeUndefined()
  })

  test("undo puts a queued prompt into an empty draft, or after the draft's text", () => {
    expect(Composer.append(draft(""), "Queued").text).toBe("Queued")
    expect(Composer.append(draft("Draft"), "Queued").text).toBe("Draft\n\nQueued")
    expect(Composer.append(draft("Draft"), "")).toEqual(draft("Draft"))
  })
})

describe("Composer delivery", () => {
  test("sends a steer while idle and the follow-up setting while working", () => {
    expect(Composer.delivery(false, "queue")).toBe("steer")
    expect(Composer.delivery(true, "steer")).toBe("steer")
    expect(Composer.delivery(true, "queue")).toBe("queue")
  })

  test("offers the other delivery only while working", () => {
    expect(Composer.alternate(false, "steer")).toBeUndefined()
    expect(Composer.alternate(true, "steer")).toBe("queue")
    expect(Composer.alternate(true, "queue")).toBe("steer")
  })
})

describe("Composer submission", () => {
  const options = { working: true, behavior: "steer" as const, alternative: false, queue: true, current: undefined }

  test("steers a running turn by default and queues with the alternate shortcut", () => {
    expect(Composer.submission(draft("Next"), options)?.delivery).toBe("steer")
    expect(Composer.submission(draft("Next"), { ...options, alternative: true })?.delivery).toBe("queue")
    expect(Composer.submission(draft("Next"), { ...options, alternative: true, queue: false })?.delivery).toBe("steer")
    expect(Composer.submission(draft("Next"), { ...options, working: false, alternative: true })?.delivery).toBe(
      "steer",
    )
    expect(Composer.submission(draft("  "), options)).toBeUndefined()
  })

  test("a steer carries the picked model and clears it; a queued prompt keeps it for later", () => {
    const picked = { ...draft("Next"), model: { id: "b", providerID: "p" } }
    const steer = Composer.submission(picked, options)
    expect(steer?.model).toEqual({ id: "b", providerID: "p" })
    expect(steer?.next).toEqual(Composer.empty)
    const queue = Composer.submission(picked, { ...options, alternative: true })
    expect(queue?.model).toBeUndefined()
    expect(queue?.next).toEqual({ ...Composer.empty, model: { id: "b", providerID: "p" } })
  })
})

describe("Composer paste", () => {
  test("handles clipboard files, and native images only when the clipboard has no text", () => {
    expect(Composer.paste({ types: [], kinds: [], text: "" }, false)).toBe("text")
    expect(Composer.paste({ types: [], kinds: [], text: "" }, true)).toBe("attachment")
    expect(Composer.paste({ types: ["text/plain"], kinds: ["string"], text: "hi" }, true)).toBe("text")
    expect(Composer.paste({ types: ["Files"], kinds: ["file"], text: "" }, false)).toBe("attachment")
  })

  test("turns a paste of 2000 characters or 20 lines into a pasted block", () => {
    expect(Composer.paste({ types: ["text/plain"], kinds: ["string"], text: "a".repeat(1999) }, false)).toBe("text")
    expect(Composer.paste({ types: ["text/plain"], kinds: ["string"], text: "a".repeat(2000) }, false)).toBe("block")
    expect(Composer.paste({ types: ["text/plain"], kinds: ["string"], text: `${"a\r\n".repeat(19)}a` }, false)).toBe(
      "block",
    )
  })

  test("shows a pasted block in the text field at the cursor", () => {
    const shown = Composer.showPasted(draft("Hello world", ["big "]), "p0", 6)
    expect(shown).toEqual({ draft: draft("Hello big world"), cursor: 10 })
  })

  test("normalizes line endings and inserts text at the cursor", () => {
    expect(Composer.normalize("a\r\nb\rc")).toBe("a\nb\nc")
    expect(Composer.insert("Hello world", "big ", 6)).toEqual({ text: "Hello big world", cursor: 10 })
    expect(Composer.insert("Hi", "!", 99)).toEqual({ text: "Hi!", cursor: 3 })
  })
})

describe("Composer queue", () => {
  test("lists queued user prompts in order and skips steers, synthetic input and compaction", () => {
    expect(
      Composer.queued([
        inbox("msg_1", "queue"),
        inbox("msg_2", "steer"),
        inbox("msg_3", "queue", "synthetic"),
        inbox("msg_4", "queue", "compaction"),
        inbox("msg_5", "queue"),
      ]),
    ).toEqual([
      { id: SessionMessage.ID.make("msg_1"), text: "msg_1 text", attachments: 0 },
      { id: SessionMessage.ID.make("msg_5"), text: "msg_5 text", attachments: 0 },
    ])
  })
})

describe("Composer model", () => {
  const models: ReadonlyArray<SessionModel.Info> = [
    { id: "a", providerID: "p", name: "A", variants: [{ id: "high" }], input: [], limit: { context: 1, output: 1 } },
    { id: "b", providerID: "p", name: "B", variants: [], input: [], limit: { context: 1, output: 1 } },
  ]

  test("shows the draft's model while the list has it, then the session's model, then the first model", () => {
    expect(
      Composer.model({ ...draft(""), model: { id: "b", providerID: "p" } }, { id: "a", providerID: "p" }, models),
    ).toEqual({
      id: "b",
      providerID: "p",
    })
    expect(
      Composer.model({ ...draft(""), model: { id: "gone", providerID: "p" } }, { id: "a", providerID: "p" }, models),
    ).toEqual({ id: "a", providerID: "p" })
    expect(Composer.model(draft(""), undefined, models)).toEqual({ id: "a", providerID: "p" })
    expect(Composer.model(draft(""), undefined, [])).toBeUndefined()
  })

  test("switches the model with a steer only when the draft picked another model or variant", () => {
    const current = { id: "a", providerID: "p" }
    expect(Composer.switching(draft(""), current)).toBeUndefined()
    expect(Composer.switching({ ...draft(""), model: current }, current)).toBeUndefined()
    expect(Composer.switching({ ...draft(""), model: { ...current, variant: "high" } }, current)).toEqual({
      ...current,
      variant: "high",
    })
  })
})

describe("Composer lists", () => {
  test("hides OpenCode's built-in skills and commands, which members can't use in Ren", () => {
    expect(Composer.hidden).toEqual({ skills: ["opencode", "report"], commands: ["init", "review"] })
    expect(
      Composer.offeredSkills([
        { id: "opencode", name: "opencode" },
        { id: "report", name: "report" },
        { id: "release-notes", name: "Release notes" },
      ]).map((skill) => skill.id),
    ).toEqual(["release-notes"])
    expect(
      Composer.offeredCommands([{ name: "init" }, { name: "review" }, { name: "deploy" }]).map(
        (command) => command.name,
      ),
    ).toEqual(["deploy"])
  })
})

describe("Composer suggestions", () => {
  test.each([
    {
      name: "opens inline commands when slash is the entire prompt",
      text: "/re",
      result: { kind: "command", query: "re" },
    },
    {
      name: "keeps inline commands closed when slash is not the entire prompt",
      text: "explain /re",
      result: undefined,
    },
    { name: "opens nested slash command names", text: "/review/", result: { kind: "command", query: "review/" } },
    {
      name: "opens context completion at the cursor",
      text: "alpha @sr omega",
      cursor: 9,
      result: { kind: "mention", start: 6, query: "sr" },
    },
    { name: "opens context completion for a bare @", text: "@", result: { kind: "mention", start: 0, query: "" } },
    { name: "ignores an @ inside a word", text: "ada@example", result: undefined },
  ])("$name", (row) => {
    expect(Composer.trigger(row.text, row.cursor ?? row.text.length)).toEqual(row.result)
  })

  const press = (key: string, ctrlKey = false) => ({ key, ctrlKey, isComposing: false })

  test("loops active popover items with arrow keys", () => {
    expect(Composer.suggestionKey(press("ArrowDown"), ["first", "second"], "second")).toEqual({
      type: "move",
      active: "first",
    })
    expect(Composer.suggestionKey(press("ArrowUp"), ["first", "second"], "first")).toEqual({
      type: "move",
      active: "second",
    })
    expect(Composer.suggestionKey(press("n", true), ["first", "second"], "first")).toEqual({
      type: "move",
      active: "second",
    })
  })

  test("closes a popover with ctrl-g before stopping a run", () => {
    expect(Composer.suggestionKey(press("g", true), ["first"], "first")).toEqual({ type: "close" })
    expect(Composer.suggestionKey(press("Escape"), ["first"], "first")).toEqual({ type: "close" })
  })

  test("selects the active item with Tab or Enter, but not while an IME composes", () => {
    expect(Composer.suggestionKey(press("Enter"), ["first"], "first")).toEqual({ type: "select", id: "first" })
    expect(Composer.suggestionKey(press("Tab"), ["first"], "first")).toEqual({ type: "select", id: "first" })
    expect(Composer.suggestionKey({ ...press("Enter"), isComposing: true }, ["first"], "first")).toBeUndefined()
  })

  test("keeps the active item while it is still listed, otherwise the first item becomes active", () => {
    expect(Composer.activeSuggestion(["first", "second"], "second")).toBe("second")
    expect(Composer.activeSuggestion(["first", "second"], "gone")).toBe("first")
    expect(Composer.activeSuggestion([], "gone")).toBeUndefined()
  })

  const commands = [{ name: "deploy" }, { name: "review/nested" }]

  test.each([
    { text: "/deploy staging now", result: { name: "deploy", text: "staging now" } },
    { text: "/deploy\nstaging", result: { name: "deploy", text: "staging" } },
    { text: "/deploy", result: { name: "deploy", text: "" } },
    { text: "/review/nested", result: { name: "review/nested", text: "" } },
    { text: "/deployx nope", result: undefined },
    { text: "ask /deploy later", result: undefined },
  ])("parses $text as a slash command", (row) => {
    expect(Composer.slash(row.text, commands)).toEqual(row.result)
  })
})

import { describe, expect, test } from "bun:test"
import { SessionKeys } from "./session-keys.js"

const press = (input: Partial<SessionKeys.Press>): SessionKeys.Press => ({
  key: "",
  code: "",
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  ...input,
})

const root = { apple: true, child: false, blocking: false }

describe("intent", () => {
  test("mod+alt+[ and mod+alt+] move between prompts", () => {
    expect(SessionKeys.intent(press({ code: "BracketLeft", key: "“", metaKey: true, altKey: true }), root)).toBe(
      "previous",
    )
    expect(
      SessionKeys.intent(press({ code: "BracketRight", key: "]", ctrlKey: true, altKey: true }), {
        ...root,
        apple: false,
      }),
    ).toBe("next")
    expect(SessionKeys.intent(press({ code: "BracketLeft", ctrlKey: true, altKey: true }), root)).toBeUndefined()
  })

  test("ctrl+b moves blocking work to the background only in the root session", () => {
    const key = press({ key: "b", ctrlKey: true })
    expect(SessionKeys.intent(key, { ...root, blocking: true })).toBe("background")
    expect(SessionKeys.intent(key, root)).toBeUndefined()
    expect(SessionKeys.intent(key, { ...root, blocking: true, child: true })).toBeUndefined()
  })

  test("Escape in a child session opens its parent", () => {
    expect(SessionKeys.intent(press({ key: "Escape" }), { ...root, child: true })).toBe("parent")
    expect(SessionKeys.intent(press({ key: "Escape" }), root)).toBeUndefined()
  })

  test("mod+f opens find in the chat", () => {
    expect(SessionKeys.intent(press({ key: "f", code: "KeyF", metaKey: true }), root)).toBe("find")
    expect(SessionKeys.intent(press({ key: "f", code: "KeyF", ctrlKey: true }), { ...root, apple: false })).toBe("find")
    expect(SessionKeys.intent(press({ key: "f", code: "KeyF", ctrlKey: true }), root)).toBeUndefined()
    expect(SessionKeys.intent(press({ key: "f", code: "KeyF", metaKey: true, shiftKey: true }), root)).toBeUndefined()
  })

  test("ignores key repeat and IME composition", () => {
    const key = press({ code: "BracketLeft", metaKey: true, altKey: true })
    expect(SessionKeys.intent({ ...key, repeat: true }, root)).toBeUndefined()
    expect(SessionKeys.intent({ ...key, isComposing: true }, root)).toBeUndefined()
  })
})

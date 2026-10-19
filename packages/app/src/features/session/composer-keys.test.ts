import { describe, expect, test } from "bun:test"
import { ComposerKeys } from "./composer-keys.js"

const key = (value: string, modifiers: Partial<Omit<ComposerKeys.Press, "key">> = {}): ComposerKeys.Press => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  repeat: false,
  isComposing: false,
  ...modifiers,
})

describe("Composer keys", () => {
  test("Mod+Enter sends with the other delivery, once per press", () => {
    expect(ComposerKeys.intent(key("Enter", { metaKey: true }), false)).toBe("alternate")
    expect(ComposerKeys.intent(key("Enter", { ctrlKey: true }), false)).toBe("alternate")
    expect(ComposerKeys.intent(key("Enter", { metaKey: true, repeat: true }), false)).toBe("swallow")
    expect(ComposerKeys.intent(key("Enter", { metaKey: true, shiftKey: true }), false)).toBeUndefined()
  })

  test("ignores every key while an IME composes", () => {
    expect(ComposerKeys.intent(key("Enter", { metaKey: true, isComposing: true }), true)).toBeUndefined()
    expect(ComposerKeys.intent(key("Escape", { isComposing: true }), true)).toBeUndefined()
    expect(ComposerKeys.intent(key("ArrowUp", { isComposing: true }), false)).toBeUndefined()
  })

  test("Escape and Ctrl+G stop only a running turn", () => {
    expect(ComposerKeys.intent(key("Escape"), true)).toBe("stop")
    expect(ComposerKeys.intent(key("g", { ctrlKey: true }), true)).toBe("stop")
    expect(ComposerKeys.intent(key("Escape"), false)).toBeUndefined()
    expect(ComposerKeys.intent(key("g", { ctrlKey: true, shiftKey: true }), true)).toBeUndefined()
  })

  test("arrows browse history only without modifiers", () => {
    expect(ComposerKeys.intent(key("ArrowUp"), false)).toBe("up")
    expect(ComposerKeys.intent(key("ArrowDown"), true)).toBe("down")
    expect(ComposerKeys.intent(key("ArrowUp", { altKey: true }), false)).toBeUndefined()
    expect(ComposerKeys.intent(key("ArrowDown", { shiftKey: true }), false)).toBeUndefined()
  })

  test("Mod+' opens the model picker", () => {
    expect(ComposerKeys.intent(key("'", { metaKey: true }), false)).toBe("model")
    expect(ComposerKeys.intent(key("'", { ctrlKey: true }), true)).toBe("model")
    expect(ComposerKeys.intent(key("'"), false)).toBeUndefined()
    expect(ComposerKeys.intent(key("'", { metaKey: true, repeat: true }), false)).toBeUndefined()
  })

  test("Mod+ArrowUp moves the first queued message back to the text field", () => {
    expect(ComposerKeys.intent(key("ArrowUp", { metaKey: true }), false)).toBe("edit")
    expect(ComposerKeys.intent(key("ArrowUp", { ctrlKey: true }), true)).toBe("edit")
    expect(ComposerKeys.intent(key("ArrowDown", { metaKey: true }), false)).toBeUndefined()
  })
})

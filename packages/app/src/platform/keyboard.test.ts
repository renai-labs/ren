import { expect, test } from "bun:test"
import { Keyboard } from "./keyboard.js"

test("the on-screen keyboard is open only while a field has focus and covers more than 100px", () => {
  expect(Keyboard.covered({ editing: true, layoutHeight: 800, viewportHeight: 450, scale: 1 })).toBe(true)
  expect(Keyboard.covered({ editing: false, layoutHeight: 800, viewportHeight: 450, scale: 1 })).toBe(false)
  expect(Keyboard.covered({ editing: true, layoutHeight: 800, viewportHeight: 720, scale: 1 })).toBe(false)
})

test("pinch zoom does not count as the keyboard", () => {
  expect(Keyboard.covered({ editing: true, layoutHeight: 800, viewportHeight: 400, scale: 2 })).toBe(false)
})

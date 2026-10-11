import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { KeyboardKey } from "../src/components/keyboard-key.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("KeyboardKey", () => {
  test("renders a kbd element", () => {
    const key = html(renderToStaticMarkup(<KeyboardKey>Tab</KeyboardKey>)).querySelector("kbd")
    expect(key?.getAttribute("data-slot")).toBe("keyboard-key")
    expect(key?.textContent).toBe("Tab")
  })
})

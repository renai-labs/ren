import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Icon } from "../src/components/icon.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Icon", () => {
  test("hides a decorative glyph from assistive technology", () => {
    const icon = html(renderToStaticMarkup(<Icon glyph="Settings" />)).querySelector("svg")
    expect(icon?.getAttribute("data-slot")).toBe("icon")
    expect(icon?.getAttribute("aria-hidden")).toBe("true")
    expect(icon?.hasAttribute("role")).toBe(false)
    expect(icon?.hasAttribute("data-tone")).toBe(false)
  })

  test("names a labelled glyph as an image", () => {
    const icon = html(renderToStaticMarkup(<Icon glyph="Settings" label="Settings" />)).querySelector("svg")
    expect(icon?.getAttribute("role")).toBe("img")
    expect(icon?.getAttribute("aria-label")).toBe("Settings")
    expect(icon?.hasAttribute("aria-hidden")).toBe(false)
  })

  test("exposes its tone", () => {
    const icon = html(renderToStaticMarkup(<Icon glyph="Settings" tone="danger" />)).querySelector("svg")
    expect(icon?.getAttribute("data-tone")).toBe("danger")
  })
})

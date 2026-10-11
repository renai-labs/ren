import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { StatusDot } from "../src/components/status-dot.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("StatusDot", () => {
  test("is decorative without a label", () => {
    const dot = html(renderToStaticMarkup(<StatusDot tone="success" />)).querySelector('[data-slot="badge-marker"]')
    expect(dot?.getAttribute("aria-hidden")).toBe("true")
    expect(dot?.hasAttribute("role")).toBe(false)
  })

  test("announces its label as an image", () => {
    const dot = html(renderToStaticMarkup(<StatusDot tone="warning" label="Keys missing" />)).querySelector(
      '[data-slot="badge-marker"]',
    )
    expect(dot?.getAttribute("role")).toBe("img")
    expect(dot?.getAttribute("aria-label")).toBe("Keys missing")
    expect(dot?.hasAttribute("aria-hidden")).toBe(false)
  })
})

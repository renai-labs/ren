import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ProgressIndicator } from "../src/components/progress-indicator.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("ProgressIndicator", () => {
  test("announces loading as a status", () => {
    const indicator = html(renderToStaticMarkup(<ProgressIndicator />)).querySelector('[role="status"]')
    expect(indicator?.getAttribute("data-slot")).toBe("progress-indicator")
    expect(indicator?.getAttribute("aria-label")).toBe("Loading")
  })

  test("uses a custom label", () => {
    const indicator = html(renderToStaticMarkup(<ProgressIndicator label="Saving" />)).querySelector('[role="status"]')
    expect(indicator?.getAttribute("aria-label")).toBe("Saving")
  })
})

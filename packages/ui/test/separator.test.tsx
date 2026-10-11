import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Separator } from "../src/components/separator.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Separator", () => {
  test("renders a horizontal separator", () => {
    const separator = html(renderToStaticMarkup(<Separator />)).querySelector('[role="separator"]')
    expect(separator?.getAttribute("data-slot")).toBe("separator")
    expect(separator?.getAttribute("aria-orientation")).toBe("horizontal")
    expect(separator?.getAttribute("data-orientation")).toBe("horizontal")
  })

  test("renders a vertical separator", () => {
    const separator = html(renderToStaticMarkup(<Separator orientation="vertical" />)).querySelector(
      '[role="separator"]',
    )
    expect(separator?.getAttribute("aria-orientation")).toBe("vertical")
  })

  test("sets a label between two rules", () => {
    const body = html(renderToStaticMarkup(<Separator label="Compaction" />))
    const labelled = body.querySelector('[data-slot="labeled-separator"]')
    expect(labelled?.textContent).toBe("Compaction")
    expect(labelled?.querySelectorAll('[role="separator"]').length).toBe(1)
    expect(labelled?.querySelectorAll('[aria-hidden="true"]').length).toBe(1)
  })
})

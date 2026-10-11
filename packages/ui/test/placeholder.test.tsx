import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Placeholder } from "../src/components/placeholder.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Placeholder", () => {
  test("is hidden from assistive technology", () => {
    const placeholder = html(renderToStaticMarkup(<Placeholder />)).firstElementChild
    expect(placeholder?.getAttribute("data-slot")).toBe("placeholder")
    expect(placeholder?.getAttribute("aria-hidden")).toBe("true")
  })
})

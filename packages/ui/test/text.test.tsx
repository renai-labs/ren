import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Icon } from "../src/components/icon.js"
import { Text } from "../src/components/text.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Text", () => {
  test("renders body copy as a paragraph", () => {
    const text = html(renderToStaticMarkup(<Text>Notes</Text>)).firstElementChild
    expect(text?.tagName).toBe("P")
    expect(text?.getAttribute("data-slot")).toBe("text")
    expect(text?.textContent).toBe("Notes")
  })

  test("picks an element for each purpose", () => {
    const tags = (["display", "title", "heading", "body", "label", "caption", "code"] as const).map(
      (purpose) => html(renderToStaticMarkup(<Text purpose={purpose}>Notes</Text>)).firstElementChild?.tagName,
    )
    expect(tags).toEqual(["H1", "H1", "H2", "P", "SPAN", "P", "CODE"])
  })

  test("renders the requested element with its attributes", () => {
    const time = html(
      renderToStaticMarkup(
        <Text element="time" dateTime="2026-10-12">
          12 Oct
        </Text>,
      ),
    ).querySelector("time")
    expect(time?.getAttribute("datetime")).toBe("2026-10-12")
    const label = html(
      renderToStaticMarkup(
        <Text purpose="label" element="label" htmlFor="name">
          Name
        </Text>,
      ),
    ).querySelector("label")
    expect(label?.getAttribute("for")).toBe("name")
  })

  test("marks itself busy while active", () => {
    const busy = (["none", "active", "shimmer"] as const).map((activity) =>
      html(renderToStaticMarkup(<Text activity={activity}>Thinking</Text>)).firstElementChild?.getAttribute(
        "aria-busy",
      ),
    )
    expect(busy).toEqual([null, "true", "true"])
  })

  test("sets a leading icon before the text", () => {
    const text = html(renderToStaticMarkup(<Text leadingIcon={<Icon glyph="Lock" />}>Private</Text>)).firstElementChild
    expect(text?.querySelector('[data-slot="icon"]')).not.toBeNull()
    expect(text?.textContent).toBe("Private")
  })
})

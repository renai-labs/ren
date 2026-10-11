import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Button", () => {
  test("renders a non-submitting button", () => {
    const button = html(renderToStaticMarkup(<Button>Save</Button>)).querySelector("button")
    expect(button?.getAttribute("type")).toBe("button")
    expect(button?.dataset["slot"]).toBe("button")
    expect(button?.textContent).toBe("Save")
  })

  test("keeps an explicit submit type", () => {
    const button = html(renderToStaticMarkup(<Button type="submit">Save</Button>)).querySelector("button")
    expect(button?.getAttribute("type")).toBe("submit")
  })

  test("disables and marks itself busy while pending", () => {
    const button = html(
      renderToStaticMarkup(
        <Button pending pendingLabel="Saving…">
          Save
        </Button>,
      ),
    ).querySelector("button")
    expect(button?.hasAttribute("disabled")).toBe(true)
    expect(button?.getAttribute("aria-busy")).toBe("true")
    expect(button?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading")
    expect(button?.textContent).toBe("Saving…")
  })

  test("renders another element without button semantics", () => {
    const body = html(
      renderToStaticMarkup(
        <Button render={<a href="/docs" />} disabled>
          Read docs
        </Button>,
      ),
    )
    const link = body.querySelector("a")
    expect(body.querySelector("button")).toBeNull()
    expect(link?.getAttribute("href")).toBe("/docs")
    expect(link?.hasAttribute("type")).toBe(false)
    expect(link?.getAttribute("aria-disabled")).toBe("true")
  })
})

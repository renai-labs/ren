import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Icon } from "../src/components/icon.js"
import { IconButton } from "../src/components/icon-button.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("IconButton", () => {
  test("names a non-submitting button with its label", () => {
    const button = html(
      renderToStaticMarkup(
        <IconButton label="Open settings">
          <Icon glyph="Settings" />
        </IconButton>,
      ),
    ).querySelector("button")
    expect(button?.getAttribute("type")).toBe("button")
    expect(button?.dataset["slot"]).toBe("icon-button")
    expect(button?.getAttribute("aria-label")).toBe("Open settings")
    expect(button?.getAttribute("title")).toBe("Open settings")
  })

  test("keeps an explicit title", () => {
    const button = html(
      renderToStaticMarkup(
        <IconButton label="Open settings" title="Settings (⌘,)">
          <Icon glyph="Settings" />
        </IconButton>,
      ),
    ).querySelector("button")
    expect(button?.getAttribute("title")).toBe("Settings (⌘,)")
  })

  test("swaps the glyph for a spinner and disables itself while pending", () => {
    const button = html(
      renderToStaticMarkup(
        <IconButton label="Start task" pending>
          <Icon glyph="Settings" />
        </IconButton>,
      ),
    ).querySelector("button")
    expect(button?.hasAttribute("disabled")).toBe(true)
    expect(button?.getAttribute("aria-busy")).toBe("true")
    expect(button?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("Loading")
    expect(button?.querySelector('[data-slot="icon"]')).toBeNull()
  })

  test("hides the attention indicator from assistive technology", () => {
    const button = html(
      renderToStaticMarkup(
        <IconButton label="Filter tasks" indicator="attention">
          <Icon glyph="ListFilter" />
        </IconButton>,
      ),
    ).querySelector("button")
    expect(button?.querySelectorAll('[aria-hidden="true"]').length).toBe(2)
  })

  test("renders another element without button semantics", () => {
    const body = html(
      renderToStaticMarkup(
        <IconButton label="New chat" render={<a href="/chat" />} disabled>
          <Icon glyph="Plus" />
        </IconButton>,
      ),
    )
    const link = body.querySelector("a")
    expect(body.querySelector("button")).toBeNull()
    expect(link?.getAttribute("href")).toBe("/chat")
    expect(link?.getAttribute("aria-label")).toBe("New chat")
    expect(link?.hasAttribute("type")).toBe(false)
    expect(link?.getAttribute("aria-disabled")).toBe("true")
  })
})

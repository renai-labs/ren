import { afterEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Badge } from "../src/components/badge.js"
import { Icon } from "../src/components/icon.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Badge", () => {
  test("renders its label", () => {
    const badge = html(renderToStaticMarkup(<Badge>Draft</Badge>)).querySelector('[data-slot="badge"]')
    expect(badge?.textContent).toBe("Draft")
    expect(badge?.querySelector("button")).toBeNull()
  })

  test("shows a decorative dot instead of the icon", () => {
    const badge = html(
      renderToStaticMarkup(
        <Badge marker="dot" icon={<Icon glyph="Check" />}>
          Running
        </Badge>,
      ),
    ).querySelector('[data-slot="badge"]')
    expect(badge?.querySelector('[data-slot="badge-marker"]')?.getAttribute("aria-hidden")).toBe("true")
    expect(badge?.querySelector('[data-slot="icon"]')).toBeNull()
  })

  test("shows the icon without a marker", () => {
    const badge = html(renderToStaticMarkup(<Badge icon={<Icon glyph="Check" />}>Connected</Badge>)).querySelector(
      '[data-slot="badge"]',
    )
    expect(badge?.querySelector('[data-slot="icon"]')).not.toBeNull()
    expect(badge?.querySelector('[data-slot="badge-marker"]')).toBeNull()
  })

  test("names the remove button", () => {
    const button = html(renderToStaticMarkup(<Badge onRemove={() => undefined}>Status</Badge>)).querySelector("button")
    expect(button?.getAttribute("type")).toBe("button")
    expect(button?.getAttribute("aria-label")).toBe("Remove")
  })

  test("removes itself when the remove button is pressed", async () => {
    const onRemove = mock(() => undefined)
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    mounted.push(root)
    await act(async () =>
      root.render(
        <Badge onRemove={onRemove} removeLabel="Remove status filter">
          Status
        </Badge>,
      ),
    )
    const button = container.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("Remove status filter")
    act(() => button?.click())
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})

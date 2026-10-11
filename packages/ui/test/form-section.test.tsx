import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { FormSection } from "../src/components/form-section.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("FormSection", () => {
  test("hides its content while closed", () => {
    const body = html(
      renderToStaticMarkup(
        <FormSection title="Advanced settings" description="Packages, build commands, and networking">
          Body
        </FormSection>,
      ),
    )
    const trigger = body.querySelector("button")
    expect(trigger?.textContent).toBe("Advanced settings" + "Packages, build commands, and networking")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(body.textContent).not.toContain("Body")
  })

  test("shows its content while open", () => {
    const body = html(
      renderToStaticMarkup(
        <FormSection title="Advanced settings" open>
          Body
        </FormSection>,
      ),
    )
    const trigger = body.querySelector("button")
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(body.querySelector(`#${trigger?.getAttribute("aria-controls") ?? "missing"}`)?.textContent).toBe("Body")
  })

  test("reports when the trigger toggles it", async () => {
    const changes: boolean[] = []
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    mounted.push(root)
    await act(async () =>
      root.render(
        <FormSection title="Advanced settings" onOpenChange={(open) => changes.push(open)}>
          Body
        </FormSection>,
      ),
    )
    await act(async () => container.querySelector("button")?.click())
    expect(changes).toEqual([true])
    expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
    expect(container.textContent).toContain("Body")
  })
})

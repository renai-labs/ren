import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Surface } from "../src/components/surface.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Surface", () => {
  test("renders every container as a surface slot", () => {
    const body = html(
      renderToStaticMarkup(
        <>
          <Surface.Panel>Panel</Surface.Panel>
          <Surface.Well>Well</Surface.Well>
          <Surface.Overlay>Overlay</Surface.Overlay>
          <Surface.Band edge="top">Band</Surface.Band>
        </>,
      ),
    )
    const slots = Array.from(body.querySelectorAll('[data-slot="surface"]'))
    expect(slots.map((slot) => slot.tagName)).toEqual(["DIV", "DIV", "DIV", "DIV"])
    expect(slots.map((slot) => slot.textContent)).toEqual(["Panel", "Well", "Overlay", "Band"])
  })

  test("renders the requested element", () => {
    const body = html(
      renderToStaticMarkup(
        <>
          <Surface.Panel element="section" aria-label="Billing">
            Plan
          </Surface.Panel>
          <Surface.Well element="span">Queued</Surface.Well>
          <Surface.Band edge="bottom" element="header">
            Files
          </Surface.Band>
        </>,
      ),
    )
    expect(body.querySelector("section")?.getAttribute("aria-label")).toBe("Billing")
    expect(body.querySelector("span")?.dataset["slot"]).toBe("surface")
    expect(body.querySelector("header")?.textContent).toBe("Files")
  })

  test("passes through other attributes", () => {
    const overlay = html(
      renderToStaticMarkup(
        <Surface.Overlay id="connection" aria-live="polite">
          Reconnecting…
        </Surface.Overlay>,
      ),
    ).querySelector("#connection")
    expect(overlay?.getAttribute("aria-live")).toBe("polite")
    expect(overlay?.textContent).toBe("Reconnecting…")
  })
})

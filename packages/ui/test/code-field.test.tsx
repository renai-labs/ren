import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CodeField } from "../src/components/code-field.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const slots = (body: HTMLElement) => [...body.querySelectorAll<HTMLInputElement>('[data-slot="code-field"] input')]

describe("CodeField", () => {
  test("renders six slots by default", () => {
    const body = html(renderToStaticMarkup(<CodeField />))
    expect(body.querySelector('[data-slot="code-field"]')).not.toBeNull()
    expect(slots(body).length).toBe(6)
  })

  test("names every slot after the first by position", () => {
    const body = html(renderToStaticMarkup(<CodeField length={4} slotLabel="Code digit" />))
    expect(slots(body).map((slot) => slot.getAttribute("aria-label"))).toEqual([
      null,
      "Code digit 2 of 4",
      "Code digit 3 of 4",
      "Code digit 4 of 4",
    ])
  })

  test("labels the first slot with the given element", () => {
    const body = html(renderToStaticMarkup(<CodeField aria-labelledby="code-prompt" />))
    expect(slots(body)[0]?.getAttribute("aria-labelledby")).toBe("code-prompt")
  })

  test("splits the value across the slots", () => {
    const body = html(renderToStaticMarkup(<CodeField length={4} value="12" />))
    expect(slots(body).map((slot) => slot.value)).toEqual(["1", "2", "", ""])
  })

  test("asks for a one-time code on the first slot", () => {
    const body = html(renderToStaticMarkup(<CodeField />))
    expect(slots(body)[0]?.getAttribute("autocomplete")).toBe("one-time-code")
  })

  test("marks every slot invalid", () => {
    const body = html(renderToStaticMarkup(<CodeField invalid />))
    expect(slots(body).every((slot) => slot.getAttribute("aria-invalid") === "true")).toBe(true)
  })

  test("disables and locks the slots", () => {
    expect(slots(html(renderToStaticMarkup(<CodeField disabled />))).every((slot) => slot.disabled)).toBe(true)
    expect(slots(html(renderToStaticMarkup(<CodeField readOnly />))).every((slot) => slot.readOnly)).toBe(true)
  })
})

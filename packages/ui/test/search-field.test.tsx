import { afterEach, describe, expect, test } from "bun:test"
import { act, useState } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { SearchField } from "../src/components/search-field.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

function Controlled(props: { initial: string; expandable?: boolean }) {
  const [value, setValue] = useState(props.initial)
  if (props.expandable === true) return <SearchField.Expandable value={value} onValueChange={setValue} />
  return <SearchField.Root value={value} onValueChange={setValue} />
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("SearchField.Root", () => {
  test("renders a labelled search input", () => {
    const input = html(
      renderToStaticMarkup(<SearchField.Root value="" onValueChange={() => undefined} placeholder="Find" />),
    ).querySelector("input")
    expect(input?.getAttribute("type")).toBe("search")
    expect(input?.getAttribute("placeholder")).toBe("Find")
    expect(input?.getAttribute("aria-label")).toBe("Find")
  })

  test("prefers an explicit label for the accessible name", () => {
    const input = html(
      renderToStaticMarkup(<SearchField.Root value="" onValueChange={() => undefined} label="Search projects" />),
    ).querySelector("input")
    expect(input?.getAttribute("aria-label")).toBe("Search projects")
    expect(input?.getAttribute("placeholder")).toBe("Search")
  })

  test("offers a clear button only while there is a value", async () => {
    const container = await mount(<Controlled initial="billing" />)
    const clear = container.querySelector('button[aria-label="Clear search"]')
    expect(clear).not.toBeNull()
    await act(async () => clear?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(container.querySelector("input")?.value).toBe("")
    expect(container.querySelector('button[aria-label="Clear search"]')).toBeNull()
  })

  test("clears the value on Escape", async () => {
    const container = await mount(<Controlled initial="billing" />)
    await act(async () =>
      container.querySelector("input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    )
    expect(container.querySelector("input")?.value).toBe("")
  })
})

describe("SearchField.Expandable", () => {
  test("starts as a button and reveals the field when pressed", async () => {
    const container = await mount(<Controlled initial="" expandable />)
    const button = container.querySelector("button")
    expect(container.querySelector("input")).toBeNull()
    expect(button?.getAttribute("aria-label")).toBe("Search")
    await act(async () => button?.click())
    expect(container.querySelector("input")?.getAttribute("type")).toBe("search")
  })

  test("stays open while it holds a value", async () => {
    const container = await mount(<Controlled initial="billing" expandable />)
    expect(container.querySelector("input")?.value).toBe("billing")
  })
})

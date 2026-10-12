import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Document } from "../src/components/document.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Document.Markdown", () => {
  test("describes its source and scale", () => {
    const element = html(
      renderToStaticMarkup(<Document.Markdown content="Hello" source="streaming" scale="standard" />),
    ).querySelector('[data-slot="document"]')
    expect(element?.getAttribute("data-source")).toBe("streaming")
    expect(element?.getAttribute("data-scale")).toBe("standard")
  })

  test("shows the plain text until the renderer loads", () => {
    const body = html(renderToStaticMarkup(<Document.Markdown content={"# Title\n\nBody"} />))
    expect(body.querySelector('[data-slot="document"] p')?.textContent).toBe("# Title\n\nBody")
  })

  test("renders markdown once the renderer loads", async () => {
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)
    mounted.push(root)
    await act(async () => root.render(<Document.Markdown content={"## Title\n\nA [link](https://example.com)"} />))
    await act(() => import("../src/lib/markdown-renderer.js"))
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
    expect(container.querySelector("h2")?.textContent).toBe("Title")
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com/")
  })
})

describe("Document parts", () => {
  test("renders code output", () => {
    const body = html(renderToStaticMarkup(<Document.Code content="ren whoami" syntax="shell" />))
    expect(body.querySelector('[data-slot="code-output"] pre')?.textContent).toBe("ren whoami")
  })

  test("renders media", () => {
    const body = html(renderToStaticMarkup(<Document.Media kind="image" source="/a.png" description="A chart" />))
    expect(body.querySelector("img")?.getAttribute("alt")).toBe("A chart")
  })
})

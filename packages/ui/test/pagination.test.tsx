import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Pagination } from "../src/components/pagination.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Pagination", () => {
  test("renders nothing for a single page", () => {
    expect(renderToStaticMarkup(<Pagination.Root page={1} pageCount={1} onPageChange={() => undefined} />)).toBe("")
    expect(renderToStaticMarkup(<Pagination.Numbered page={1} pageCount={0} onPageChange={() => undefined} />)).toBe("")
  })

  test("shows the position and disables the edge buttons", () => {
    const body = html(renderToStaticMarkup(<Pagination.Root page={1} pageCount={4} onPageChange={() => undefined} />))
    expect(body.querySelector("nav")?.getAttribute("aria-label")).toBe("Pagination")
    expect(body.querySelector("span")?.textContent).toBe("1 / 4")
    const buttons = [...body.querySelectorAll("button")]
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual(["Previous page", "Next page"])
    expect(buttons.map((button) => button.hasAttribute("disabled"))).toEqual([true, false])
  })

  test("numbers every page when there are few", () => {
    const buttons = html(
      renderToStaticMarkup(<Pagination.Numbered page={2} pageCount={5} onPageChange={() => undefined} />),
    ).querySelectorAll("button:not([aria-label])")
    expect([...buttons].map((button) => button.textContent)).toEqual(["1", "2", "3", "4", "5"])
    expect([...buttons].map((button) => button.getAttribute("aria-current"))).toEqual([null, "page", null, null, null])
  })

  test("collapses distant pages into gaps", () => {
    const nav = html(
      renderToStaticMarkup(<Pagination.Numbered page={6} pageCount={12} onPageChange={() => undefined} />),
    ).querySelector("nav")
    const labels = [...(nav?.children ?? [])].slice(1, -1).map((child) => child.textContent)
    expect(labels).toEqual(["1", "…", "5", "6", "7", "…", "12"])
  })

  test("reports the requested page", async () => {
    const requested: number[] = []
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    mounted.push(root)
    await act(async () =>
      root.render(<Pagination.Numbered page={6} pageCount={12} onPageChange={(page) => requested.push(page)} />),
    )
    const button = (name: string) =>
      [...document.body.querySelectorAll("button")].find(
        (candidate) => candidate.getAttribute("aria-label") === name || candidate.textContent === name,
      )
    await act(async () => button("Next page")?.click())
    await act(async () => button("Previous page")?.click())
    await act(async () => button("12")?.click())
    expect(requested).toEqual([7, 5, 12])
  })
})

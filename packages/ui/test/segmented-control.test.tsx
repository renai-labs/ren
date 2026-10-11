import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { SegmentedControl } from "../src/components/segmented-control.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []
const options = [
  { value: "board", label: "Board" },
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar", disabled: true },
]

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("SegmentedControl", () => {
  test("renders a labelled group with the current segment pressed", () => {
    const body = html(
      renderToStaticMarkup(
        <SegmentedControl label="View" value="list" onValueChange={() => undefined} options={options} />,
      ),
    )
    const group = body.querySelector('[role="group"]')
    expect(group?.getAttribute("aria-label")).toBe("View")
    expect(group?.getAttribute("data-slot")).toBe("segmented-control")
    const buttons = [...body.querySelectorAll("button")]
    expect(buttons.map((button) => button.textContent)).toEqual(["Board", "List", "Calendar"])
    expect(buttons.map((button) => button.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"])
  })

  test("disables individual segments", () => {
    const buttons = html(
      renderToStaticMarkup(
        <SegmentedControl label="View" value="list" onValueChange={() => undefined} options={options} />,
      ),
    ).querySelectorAll("button")
    expect([...buttons].map((button) => button.hasAttribute("disabled"))).toEqual([false, false, true])
  })

  test("reports a newly chosen segment and ignores the current one", async () => {
    const chosen: string[] = []
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    mounted.push(root)
    await act(async () =>
      root.render(
        <SegmentedControl label="View" value="list" onValueChange={(value) => chosen.push(value)} options={options} />,
      ),
    )
    const buttons = [...document.body.querySelectorAll("button")]
    await act(async () => buttons[1]?.click())
    await act(async () => buttons[0]?.click())
    expect(chosen).toEqual(["board"])
  })
})

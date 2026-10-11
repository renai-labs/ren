import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { Tooltip } from "../src/components/tooltip.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Tooltip", () => {
  test("renders the child as the trigger", () => {
    const body = html(
      renderToStaticMarkup(
        <Tooltip.Root content="Copy a link to this session">
          <Button>Share</Button>
        </Tooltip.Root>,
      ),
    )
    const buttons = body.querySelectorAll("button")
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.dataset["slot"]).toBe("button")
    expect(buttons[0]?.textContent).toBe("Share")
    expect(body.querySelector('[data-slot="tooltip"]')).toBeNull()
  })

  test("renders only the child without content", () => {
    const body = html(
      renderToStaticMarkup(
        <Tooltip.Root content="">
          <Button>Share</Button>
        </Tooltip.Root>,
      ),
    )
    expect(body.querySelector("button")?.hasAttribute("data-trigger-disabled")).toBe(false)
    expect(body.innerHTML).toBe(renderToStaticMarkup(<Button>Share</Button>))
  })

  test("shows the content while open", async () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    mounted.push(root)
    await act(async () =>
      root.render(
        <Tooltip.Provider>
          <Tooltip.Root content="Copy a link to this session" open>
            <Button>Share</Button>
          </Tooltip.Root>
        </Tooltip.Provider>,
      ),
    )
    expect(document.body.querySelector('[data-slot="tooltip"]')?.textContent).toBe("Copy a link to this session")
    expect(document.body.querySelector("button")?.hasAttribute("data-popup-open")).toBe(true)
  })
})

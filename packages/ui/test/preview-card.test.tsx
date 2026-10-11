import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { PreviewCard } from "../src/components/preview-card.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("PreviewCard", () => {
  test("renders the trigger element and no card while closed", () => {
    const body = html(
      renderToStaticMarkup(
        <PreviewCard.Root>
          <PreviewCard.Trigger render={<Button>Design review</Button>} />
          <PreviewCard.Content>4 open tasks</PreviewCard.Content>
        </PreviewCard.Root>,
      ),
    )
    expect(body.querySelectorAll("button").length).toBe(1)
    expect(body.querySelector("button")?.dataset["slot"]).toBe("button")
    expect(body.querySelector('[data-slot="popover"]')).toBeNull()
  })

  test("shows the card on the requested side while open", async () => {
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    mounted.push(root)
    await act(async () =>
      root.render(
        <PreviewCard.Root open>
          <PreviewCard.Trigger render={<Button>Design review</Button>} />
          <PreviewCard.Content placement="right">4 open tasks</PreviewCard.Content>
        </PreviewCard.Root>,
      ),
    )
    const card = document.body.querySelector('[data-slot="popover"]')
    expect(card?.textContent).toBe("4 open tasks")
    expect(card?.getAttribute("data-side")).toBe("right")
    expect(document.body.querySelector("button")?.hasAttribute("data-popup-open")).toBe(true)
  })
})

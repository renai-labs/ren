import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { Popover } from "../src/components/popover.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
  return document.body
}

describe("Popover", () => {
  test("renders the trigger element and no popup while closed", () => {
    const body = html(
      renderToStaticMarkup(
        <Popover.Root>
          <Popover.Trigger render={<Button>Display</Button>} />
          <Popover.Content label="Task display">Options</Popover.Content>
        </Popover.Root>,
      ),
    )
    const buttons = body.querySelectorAll("button")
    expect(buttons.length).toBe(1)
    expect(buttons[0]?.dataset["slot"]).toBe("button")
    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false")
    expect(body.querySelector('[data-slot="popover"]')).toBeNull()
  })

  test("shows the labelled popup while open", async () => {
    const body = await mount(
      <Popover.Root open>
        <Popover.Trigger render={<Button>Display</Button>} />
        <Popover.Content label="Task display">Options</Popover.Content>
      </Popover.Root>,
    )
    const popup = body.querySelector('[data-slot="popover"]')
    expect(popup?.getAttribute("aria-label")).toBe("Task display")
    expect(popup?.getAttribute("role")).toBe("dialog")
    expect(popup?.textContent).toBe("Options")
    expect(body.querySelector("button")?.getAttribute("aria-expanded")).toBe("true")
  })

  test("places the popup on the requested side and alignment", async () => {
    const body = await mount(
      <Popover.Root open>
        <Popover.Trigger render={<Button>Display</Button>} />
        <Popover.Content placement="top" alignment="end">
          Options
        </Popover.Content>
      </Popover.Root>,
    )
    const popup = body.querySelector('[data-slot="popover"]')
    expect(popup?.getAttribute("data-side")).toBe("top")
    expect(popup?.getAttribute("data-align")).toBe("end")
  })

  test("closes from the close part", async () => {
    const changes: boolean[] = []
    const body = await mount(
      <Popover.Root defaultOpen onOpenChange={(open) => changes.push(open)}>
        <Popover.Trigger render={<Button>Display</Button>} />
        <Popover.Content>
          <Popover.Close render={<Button>Done</Button>} />
        </Popover.Content>
      </Popover.Root>,
    )
    const done = [...body.querySelectorAll("button")].find((button) => button.textContent === "Done")
    await act(async () => done?.click())
    expect(changes).toEqual([false])
  })
})

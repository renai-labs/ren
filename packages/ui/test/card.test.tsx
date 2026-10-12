import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Card } from "../src/components/card.js"

const html = (element: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html").body
const mounted: Root[] = []

const mount = async (element: ReactElement) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(element))
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Card.Root", () => {
  test("renders a static card with its title and description", () => {
    const body = html(<Card.Root title="Release notes" description="Draft the changelog" metadata="2 files" />)
    const card = body.querySelector('[data-slot="card"]')
    expect(card?.tagName).toBe("DIV")
    expect(card?.textContent).toBe("Release notesDraft the changelog2 files")
    expect(body.querySelector("button, a")).toBeNull()
  })

  test("activates a button card and keeps its actions outside the button", async () => {
    const selections: string[] = []
    await mount(
      <Card.Root
        title="Release notes"
        interaction="button"
        label="Open release notes"
        onSelect={() => selections.push("card")}
        actions={<button type="button">Remove</button>}
      />,
    )
    const card = document.body.querySelector<HTMLButtonElement>('button[data-slot="card"]')
    expect(card?.getAttribute("aria-label")).toBe("Open release notes")
    expect(card?.textContent).not.toContain("Remove")
    await act(async () => card?.click())
    expect(selections).toEqual(["card"])
  })

  test("disables a button card", () => {
    const body = html(<Card.Root title="Release notes" interaction="button" disabled />)
    expect(body.querySelector("button")?.hasAttribute("disabled")).toBe(true)
  })

  test("exposes a selection card as a checked radio", () => {
    const body = html(<Card.Root title="Staging" interaction="selection" selected />)
    const radio = body.querySelector('[role="radio"]')
    expect(radio?.getAttribute("aria-checked")).toBe("true")
  })

  test("renders a link card through the render element", () => {
    const body = html(
      <Card.Root
        title="Ren"
        interaction="link"
        render={<a href="/projects/ren" />}
        label="Open Ren"
        metadata="3 tasks"
      />,
    )
    const link = body.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/projects/ren")
    expect(link?.getAttribute("aria-label")).toBe("Open Ren")
    expect(link?.getAttribute("data-slot")).toBe("card")
    expect(link?.textContent).toContain("3 tasks")
  })

  test("staggers the entrance by appearance order", () => {
    const body = html(<Card.Root title="Ren" appearanceOrder={3} />)
    expect(body.querySelector<HTMLElement>('[data-slot="card"]')?.style.animationDelay).toBe("90ms")
  })
})

describe("Card.Divided", () => {
  test("marks the card and its section as selected", () => {
    const body = html(
      <Card.Divided selected>
        <Card.Header actions={<button type="button">Stop</button>}>Session</Card.Header>
        <Card.Section onSelect={() => undefined} label="Open the session" metadata="2m">
          Reviewing
        </Card.Section>
      </Card.Divided>,
    )
    expect(body.querySelector('[data-slot="card"]')?.hasAttribute("data-selected")).toBe(true)
    const section = body.querySelector('button[aria-label="Open the session"]')
    expect(section?.getAttribute("aria-pressed")).toBe("true")
    expect(section?.textContent).toBe("Reviewing2m")
  })

  test("disables a section without a select handler", () => {
    const body = html(
      <Card.Divided>
        <Card.Section>Reviewing</Card.Section>
      </Card.Divided>,
    )
    const section = body.querySelector("button")
    expect(section?.hasAttribute("disabled")).toBe(true)
    expect(section?.hasAttribute("aria-pressed")).toBe(false)
  })
})

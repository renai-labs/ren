import { describe, expect, test } from "bun:test"
import type { ReactElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { PageShell } from "../src/components/page-shell.js"

const render = (node: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(node), "text/html").body

describe("PageShell", () => {
  test("Root defaults to the collection layout and renders the heading", () => {
    const body = render(
      <PageShell.Root title="Projects" subtitle="Everything" actions={<button type="button">New</button>}>
        Body
      </PageShell.Root>,
    )
    expect(body.querySelector('[data-slot="page-shell"]')?.getAttribute("data-layout")).toBe("collection")
    expect(body.querySelector("h1")?.textContent).toBe("Projects")
    expect(body.querySelector("header p")?.textContent).toBe("Everything")
    expect(body.querySelector("header button")?.textContent).toBe("New")
  })

  test("Root leaves out the heading without a title or actions", () => {
    const body = render(<PageShell.Root layout="board">Body</PageShell.Root>)
    expect(body.querySelector('[data-slot="page-shell"]')?.getAttribute("data-layout")).toBe("board")
    expect(body.querySelector("header")).toBeNull()
  })

  test("Root pins the scope outside the scroller", () => {
    const body = render(
      <PageShell.Root scope="All teams" context="Back">
        Body
      </PageShell.Root>,
    )
    expect(body.querySelector('[data-slot="page-scope"]')?.textContent).toBe("All teams")
    expect(body.textContent).toContain("Back")
  })

  test("Record renders a banner and an aside", () => {
    const body = render(
      <PageShell.Record banner="Task" aside="Properties">
        Body
      </PageShell.Record>,
    )
    expect(body.querySelector('[data-slot="page-shell"]')?.getAttribute("data-layout")).toBe("record")
    expect(body.querySelector("header")?.textContent).toBe("Task")
    expect(body.querySelector('[data-slot="page-aside"]')?.textContent).toBe("Properties")
    expect(render(<PageShell.Record>Body</PageShell.Record>).querySelector('[data-slot="page-aside"]')).toBeNull()
  })

  test("Section titles its content and frames it when divided", () => {
    const body = render(
      <PageShell.Section title="Devices" description="Where you are signed in" frame="divided">
        <span>Laptop</span>
      </PageShell.Section>,
    )
    expect(body.querySelector("section h2")?.textContent).toBe("Devices")
    expect(body.querySelector("section p")?.textContent).toBe("Where you are signed in")
    expect(body.querySelector('[data-slot="page-section-frame"]')?.textContent).toBe("Laptop")
    expect(
      render(<PageShell.Section>Laptop</PageShell.Section>).querySelector('[data-slot="page-section-frame"]'),
    ).toBeNull()
  })
})

import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Button } from "../src/components/button.js"
import { Link } from "../src/components/link.js"
import { Toolbar } from "../src/components/toolbar.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Toolbar", () => {
  test("renders a labelled toolbar", () => {
    const toolbar = html(
      renderToStaticMarkup(
        <Toolbar.Root label="Projects">
          <Toolbar.Button render={<Button>Export</Button>} />
        </Toolbar.Root>,
      ),
    ).querySelector('[role="toolbar"]')
    expect(toolbar?.getAttribute("aria-label")).toBe("Projects")
    expect(toolbar?.getAttribute("aria-orientation")).toBe("horizontal")
    expect(toolbar?.getAttribute("data-slot")).toBe("toolbar")
  })

  test("renders the given controls as toolbar items", () => {
    const body = html(
      renderToStaticMarkup(
        <Toolbar.Root label="Projects">
          <Toolbar.Link render={<Link href="/docs">View docs</Link>} />
          <Toolbar.Button render={<Button>Export</Button>} />
        </Toolbar.Root>,
      ),
    )
    expect(body.querySelector("a")?.getAttribute("href")).toBe("/docs")
    expect(body.querySelector("a")?.dataset["slot"]).toBe("link")
    expect(body.querySelector("button")?.dataset["slot"]).toBe("button")
    expect(body.querySelector("button")?.textContent).toBe("Export")
  })

  test("disables a toolbar button", () => {
    const button = html(
      renderToStaticMarkup(
        <Toolbar.Root label="Projects">
          <Toolbar.Button disabled render={<Button>Archive</Button>} />
        </Toolbar.Root>,
      ),
    ).querySelector("button")
    expect(button?.hasAttribute("disabled")).toBe(true)
  })

  test("omits empty regions", () => {
    const toolbar = html(
      renderToStaticMarkup(<Toolbar.Root label="Members" leading={<span>Members</span>} />),
    ).querySelector('[role="toolbar"]')
    expect(toolbar?.children.length).toBe(1)
    expect(toolbar?.textContent).toBe("Members")
  })
})

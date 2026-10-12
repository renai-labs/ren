import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Breadcrumbs } from "../src/components/breadcrumbs.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Breadcrumbs", () => {
  test("renders a labelled trail that links earlier pages", () => {
    const body = html(
      renderToStaticMarkup(
        <Breadcrumbs.Root>
          <Breadcrumbs.Link render={<a href="/projects" />}>Projects</Breadcrumbs.Link>
          <Breadcrumbs.Item>Ren</Breadcrumbs.Item>
          <Breadcrumbs.Page>Settings</Breadcrumbs.Page>
        </Breadcrumbs.Root>,
      ),
    )
    expect(body.querySelector("nav")?.getAttribute("aria-label")).toBe("Breadcrumb")
    expect([...body.querySelectorAll("li")].map((item) => item.textContent)).toEqual(["Projects", "Ren", "Settings"])
    expect([...body.querySelectorAll("a")].map((link) => link.getAttribute("href"))).toEqual(["/projects"])
    expect(body.querySelector('[aria-current="page"]')?.textContent).toBe("Settings")
  })

  test("separates crumbs with hidden chevrons", () => {
    const icons = html(
      renderToStaticMarkup(
        <Breadcrumbs.Root>
          <Breadcrumbs.Item>Tasks</Breadcrumbs.Item>
          <Breadcrumbs.Page>Migrate billing</Breadcrumbs.Page>
        </Breadcrumbs.Root>,
      ),
    ).querySelectorAll('[data-slot="icon"]')
    expect(icons.length).toBe(1)
    expect(icons[0]?.getAttribute("aria-hidden")).toBe("true")
  })
})

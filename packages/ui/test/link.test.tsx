import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Link } from "../src/components/link.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Link", () => {
  test("renders an anchor", () => {
    const link = html(renderToStaticMarkup(<Link href="/pricing">View pricing</Link>)).querySelector("a")
    expect(link?.getAttribute("href")).toBe("/pricing")
    expect(link?.dataset["slot"]).toBe("link")
    expect(link?.hasAttribute("target")).toBe(false)
    expect(link?.textContent).toBe("View pricing")
  })

  test("opens external links in a new tab without a referrer", () => {
    const link = html(
      renderToStaticMarkup(
        <Link href="https://docs.ren.ai" external>
          Read the CLI guide
        </Link>,
      ),
    ).querySelector("a")
    expect(link?.getAttribute("target")).toBe("_blank")
    expect(link?.getAttribute("rel")).toBe("noreferrer")
  })

  test("renders through another element", () => {
    const body = html(
      renderToStaticMarkup(
        <Link appearance="navigation" render={<a href="/settings/keys" aria-current="page" />}>
          Inference keys
        </Link>,
      ),
    )
    const links = body.querySelectorAll("a")
    expect(links.length).toBe(1)
    expect(links[0]?.getAttribute("href")).toBe("/settings/keys")
    expect(links[0]?.getAttribute("aria-current")).toBe("page")
    expect(links[0]?.dataset["slot"]).toBe("link")
  })
})

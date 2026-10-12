import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { Media } from "../src/components/media.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body

describe("Media", () => {
  test("renders a lazily loaded image described by its alt text", () => {
    const image = html(
      renderToStaticMarkup(<Media kind="image" source="/a.png" description="A chart" />),
    ).querySelector("img")
    expect(image?.getAttribute("alt")).toBe("A chart")
    expect(image?.getAttribute("loading")).toBe("lazy")
    expect(image?.dataset["slot"]).toBe("media")
  })

  test("renders a labelled video with controls and a poster", () => {
    const video = html(
      renderToStaticMarkup(<Media kind="video" source="/a.mp4" poster="/a.png" description="A walkthrough" />),
    ).querySelector("video")
    expect(video?.getAttribute("aria-label")).toBe("A walkthrough")
    expect(video?.hasAttribute("controls")).toBe(true)
    expect(video?.getAttribute("poster")).toBe("/a.png")
  })

  test("renders a titled embed without a sandbox by default", () => {
    const frame = html(
      renderToStaticMarkup(<Media kind="embed" source="https://example.com" description="A demo" />),
    ).querySelector("iframe")
    expect(frame?.getAttribute("title")).toBe("A demo")
    expect(frame?.hasAttribute("sandbox")).toBe(false)
    expect(frame?.hasAttribute("allowfullscreen")).toBe(true)
  })

  test("sandboxes an isolated embed", () => {
    const frame = html(
      renderToStaticMarkup(
        <Media kind="embed" isolation="sandboxed" source="https://example.com" description="A document" />,
      ),
    ).querySelector("iframe")
    expect(frame?.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-popups allow-forms")
    expect(frame?.hasAttribute("allow")).toBe(false)
  })

  test("wraps a captioned item in a figure", () => {
    const body = html(
      renderToStaticMarkup(<Media kind="image" source="/a.png" description="A chart" caption="Revenue by month" />),
    )
    expect(body.querySelector("figure img")?.getAttribute("alt")).toBe("A chart")
    expect(body.querySelector("figcaption")?.textContent).toBe("Revenue by month")
  })
})

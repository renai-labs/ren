import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { AttachmentTile } from "../src/components/attachment-tile.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("AttachmentTile.Thumbnail", () => {
  test("shows the image with the file name as its alternative text", () => {
    const body = html(renderToStaticMarkup(<AttachmentTile.Thumbnail name="sunrise.png" image="/sunrise.png" />))
    const tile = body.querySelector("[data-slot='attachment']")
    expect(tile?.getAttribute("data-presentation")).toBe("thumbnail")
    expect(tile?.getAttribute("title")).toBe("sunrise.png")
    expect(body.querySelector("img")?.getAttribute("alt")).toBe("sunrise.png")
  })

  test("falls back to the glyph and name without an image", () => {
    const body = html(renderToStaticMarkup(<AttachmentTile.Thumbnail name="brief.pdf" glyph="File" />))
    expect(body.querySelector("img")).toBeNull()
    expect(body.querySelector("[data-slot='icon']")).not.toBeNull()
    expect(body.textContent).toBe("brief.pdf")
  })

  test("shows only a progress indicator while resolving", () => {
    const body = html(renderToStaticMarkup(<AttachmentTile.Thumbnail name="brief.pdf" state="resolving" />))
    expect(body.querySelector("[role='status']")?.getAttribute("aria-label")).toBe("Loading")
    expect(body.textContent).toBe("")
  })

  test("reports a broken image", async () => {
    const failures: string[] = []
    const container = await mount(
      <AttachmentTile.Thumbnail
        name="broken.png"
        image="/broken.png"
        onImageError={(image) => failures.push(image.alt)}
      />,
    )
    await act(async () => container.querySelector("img")?.dispatchEvent(new Event("error")))
    expect(failures).toContain("broken.png")
  })

  test("removes with a labelled button", async () => {
    const removed: string[] = []
    const container = await mount(
      <AttachmentTile.Thumbnail name="brief.pdf" onRemove={() => removed.push("brief.pdf")} />,
    )
    const button = container.querySelector("button")
    expect(button?.getAttribute("aria-label")).toBe("Remove brief.pdf")
    await act(async () => button?.click())
    expect(removed).toEqual(["brief.pdf"])
  })
})

describe("AttachmentTile.Chip", () => {
  test("renders the name, detail and state", () => {
    const body = html(
      renderToStaticMarkup(
        <AttachmentTile.Chip name="brief.pdf" glyph="File" detail="Not attached" state="unavailable" />,
      ),
    )
    const chip = body.querySelector("[data-slot='attachment']")
    expect(chip?.getAttribute("data-presentation")).toBe("chip")
    expect(chip?.getAttribute("data-state")).toBe("unavailable")
    expect(body.textContent).toBe("brief.pdfNot attached")
    expect(body.querySelector("button")).toBeNull()
  })

  test("uses a custom remove label", () => {
    const body = html(
      renderToStaticMarkup(
        <AttachmentTile.Chip name="brief.pdf" removeLabel="Detach brief" onRemove={() => undefined} />,
      ),
    )
    expect(body.querySelector("button")?.getAttribute("aria-label")).toBe("Detach brief")
  })
})

describe("AttachmentTile.Excerpt", () => {
  test("renders the name, excerpt and footer", () => {
    const body = html(
      renderToStaticMarkup(
        <AttachmentTile.Excerpt name="Pasted text" footer="120 characters" data-testid="pasted">
          Hello there
        </AttachmentTile.Excerpt>,
      ),
    )
    const excerpt = body.querySelector("[data-testid='pasted']")
    expect(excerpt?.getAttribute("data-presentation")).toBe("excerpt")
    expect(excerpt?.textContent).toBe("Pasted textHello there120 characters")
  })
})

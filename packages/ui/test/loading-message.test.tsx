import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LoadingMessage } from "../src/components/loading-message.js"
import type { LoadingMessageProps } from "../src/components/loading-message.js"

const message = (props: LoadingMessageProps) =>
  new DOMParser()
    .parseFromString(renderToStaticMarkup(<LoadingMessage {...props} />), "text/html")
    .body.querySelector('[data-slot="state-message"]')

describe("LoadingMessage", () => {
  test("is an output labelled Loading by default", () => {
    const element = message({})
    expect(element?.tagName).toBe("OUTPUT")
    expect(element?.getAttribute("aria-label")).toBe("Loading")
    expect(element?.getAttribute("data-state")).toBe("loading")
    expect(element?.querySelector('[data-slot="progress-indicator"]')).not.toBeNull()
  })

  test("uses a string title as its label and shows it", () => {
    const element = message({ title: "Loading preview…", description: "Large files take longer." })
    expect(element?.getAttribute("aria-label")).toBe("Loading preview…")
    expect(element?.textContent).toBe("Loading preview…Large files take longer.")
  })

  test("hides the title and description inline", () => {
    const element = message({ placement: "inline", title: "Loading labels…", description: "Almost there." })
    expect(element?.getAttribute("aria-label")).toBe("Loading labels…")
    expect(element?.textContent).toBe("")
  })
})

import { describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { StateMessage } from "../src/components/state-message.js"
import type { StateMessageProps } from "../src/components/state-message.js"

const message = (props: StateMessageProps) =>
  new DOMParser()
    .parseFromString(renderToStaticMarkup(<StateMessage {...props} />), "text/html")
    .body.querySelector('[data-slot="state-message"]')

describe("StateMessage", () => {
  test("shows a default title for each state", () => {
    expect(message({ state: "empty" })?.textContent).toBe("Nothing here yet.")
    expect(message({ state: "no-results" })?.textContent).toBe("No results match your search.")
    expect(message({ state: "complete" })?.textContent).toBe("Done")
    expect(message({ state: "failed" })?.textContent).toBe("Unable to load this.")
    expect(message({ state: "unavailable" })?.textContent).toBe("This is no longer available.")
  })

  test("marks its state and announces failures as alerts", () => {
    const failed = message({ state: "failed", title: "Unable to load sessions." })
    expect(failed?.getAttribute("data-state")).toBe("failed")
    expect(failed?.getAttribute("role")).toBe("alert")
    expect(message({ state: "empty" })?.hasAttribute("role")).toBe(false)
  })

  test("shows a state glyph except inline", () => {
    expect(message({ state: "failed" })?.querySelector('[data-slot="icon"]')).not.toBeNull()
    expect(message({ state: "empty" })?.querySelector('[data-slot="icon"]')).toBeNull()
    expect(message({ state: "failed", placement: "inline" })?.querySelector('[data-slot="icon"]')).toBeNull()
    expect(
      message({ state: "empty", icon: <span data-testid="custom" /> })?.querySelector("[data-testid]"),
    ).not.toBeNull()
  })

  test("renders the description and action", () => {
    const element = message({
      state: "empty",
      title: "No projects yet.",
      description: "Projects group sessions.",
      action: "Create",
    })
    expect(element?.textContent).toBe("No projects yet.Projects group sessions.Create")
  })

  test("calls onRetry from the retry button", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const calls: string[] = []
    await act(async () =>
      root.render(<StateMessage state="failed" onRetry={() => calls.push("retry")} retryLabel="Reload sessions" />),
    )
    const button = container.querySelector("button")
    expect(button?.textContent).toBe("Reload sessions")
    await act(async () => button?.click())
    expect(calls).toEqual(["retry"])
    await act(async () => root.unmount())
  })

  test("labels the retry button by default", () => {
    expect(message({ state: "failed", onRetry: () => undefined })?.querySelector("button")?.textContent).toBe(
      "Try again",
    )
  })
})

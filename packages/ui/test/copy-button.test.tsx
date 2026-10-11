import { afterEach, describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { CopyButton } from "../src/components/copy-button.js"

const mounted: Root[] = []

const mount = async (onCopy: (value: string) => void | Promise<void>, onContainerClick = () => undefined) => {
  const row = document.body.appendChild(document.createElement("div"))
  row.addEventListener("click", onContainerClick)
  const container = row.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(<CopyButton value="ren_live_4f9a2c" label="Copy token" onCopy={onCopy} />))
  return container
}

const click = (container: HTMLElement) =>
  act(async () => {
    container.querySelector("button")?.click()
    await Promise.resolve()
  })

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("CopyButton", () => {
  test("copies its value and confirms it", async () => {
    const copied: string[] = []
    const container = await mount((value) => {
      copied.push(value)
    })
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Copy token")
    await click(container)
    expect(copied).toEqual(["ren_live_4f9a2c"])
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Copied")
  })

  test("reports a failed copy", async () => {
    const container = await mount(() => Promise.reject(new Error("Clipboard unavailable")))
    await click(container)
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Copy failed. Try again")
  })

  test("never triggers the surrounding container", async () => {
    const containerClick = mock(() => undefined)
    const container = await mount(() => undefined, containerClick)
    await click(container)
    expect(containerClick).not.toHaveBeenCalled()
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Theme } from "../src/components/theme.js"

const html = document.documentElement
const mounted: Root[] = []

const renderTheme = (root: Root, preference: Theme.Preference) =>
  act(async () =>
    root.render(
      <Theme.Provider preference={preference} onPreferenceChange={() => undefined}>
        <span />
      </Theme.Provider>,
    ),
  )

const mount = () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  return root
}

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve))

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
})

describe("Theme.Provider", () => {
  test("applies the appearance classes to the document", async () => {
    const root = mount()
    await renderTheme(root, "girliepop")
    expect([...html.classList].toSorted()).toEqual(["girliepop", "light"])
    await renderTheme(root, "dark")
    expect([...html.classList]).toEqual(["dark"])
  })

  test("swaps the theme classes while transitions are paused", async () => {
    const root = mount()
    await renderTheme(root, "light")
    await nextFrame()
    const changes: Array<string | null> = []
    const observer = new MutationObserver((records) => changes.push(...records.map((record) => record.attributeName)))
    observer.observe(html, { attributes: true, attributeFilter: ["class", "data-theme-switching"] })
    await renderTheme(root, "dark")
    await nextFrame()
    observer.disconnect()
    expect(changes.at(0)).toBe("data-theme-switching")
    expect(changes).toContain("class")
    expect(changes.at(-1)).toBe("data-theme-switching")
    expect(html.hasAttribute("data-theme-switching")).toBe(false)
  })

  test("never leaves transitions paused after unmounting", async () => {
    await renderTheme(mount(), "light")
    act(() => mounted.splice(0).forEach((root) => root.unmount()))
    expect(html.hasAttribute("data-theme-switching")).toBe(false)
  })
})

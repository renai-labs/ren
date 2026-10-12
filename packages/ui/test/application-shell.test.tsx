import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { ApplicationShell } from "../src/components/application-shell.js"

const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

const button = (label: string) => document.body.querySelector<HTMLElement>(`[aria-label="${label}"]`)

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

const shell = (props: Partial<ApplicationShell.RootProps>, onActivate?: () => void) => (
  <ApplicationShell.Root
    mobile={false}
    state="expanded"
    onStateChange={() => undefined}
    navigation={
      <ApplicationShell.NavigationSection title="Pages">
        <ApplicationShell.NavigationItem current label="Home" render={<a href="#home" />} />
        <ApplicationShell.NavigationItem label="Search" shortcut="Meta+K" onActivate={onActivate} />
      </ApplicationShell.NavigationSection>
    }
    {...props}
  >
    Content
  </ApplicationShell.Root>
)

describe("ApplicationShell", () => {
  test("renders the navigation as a labelled aside next to the content", async () => {
    await mount(shell({ state: "collapsed" }))
    const aside = document.body.querySelector('aside[aria-label="Navigation"]')
    expect(aside?.getAttribute("data-state")).toBe("collapsed")
    expect(document.body.querySelector("main")?.textContent).toBe("Content")
    expect(button("Expand sidebar")?.getAttribute("aria-keyshortcuts")).toBe("Meta+B Control+B")
    expect(document.body.querySelector("a")?.getAttribute("aria-label")).toBe("Home")
  })

  test("toggles the sidebar from its button and the keyboard shortcut", async () => {
    const changes: ApplicationShell.NavigationState[] = []
    await mount(shell({ onStateChange: (state) => changes.push(state) }))
    await act(async () => button("Collapse sidebar")?.click())
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true })))
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" })))
    expect(changes).toEqual(["collapsed", "collapsed"])
  })

  test("listens through the given key subscription", async () => {
    const listeners: Array<(event: KeyboardEvent) => void> = []
    const changes: ApplicationShell.NavigationState[] = []
    await mount(
      shell({
        state: "collapsed",
        onStateChange: (state) => changes.push(state),
        subscribeKeyDown: (listener) => {
          listeners.push(listener)
          return () => undefined
        },
      }),
    )
    await act(async () =>
      listeners.forEach((listener) => listener(new KeyboardEvent("keydown", { key: "B", ctrlKey: true }))),
    )
    expect(changes).toEqual(["expanded"])
  })

  test("marks the current item and renders links through render", async () => {
    await mount(shell({}))
    const link = document.body.querySelector("a")
    expect(link?.getAttribute("href")).toBe("#home")
    expect(link?.getAttribute("aria-current")).toBe("page")
    const search = [...document.body.querySelectorAll("button")].find((element) => element.textContent === "Search")
    expect(search?.getAttribute("type")).toBe("button")
    expect(search?.getAttribute("aria-keyshortcuts")).toBe("Meta+K")
    expect(search?.hasAttribute("aria-current")).toBe(false)
    expect(document.body.querySelector("section h2")?.textContent).toBe("Pages")
  })

  test("opens the navigation in a drawer on mobile and dismisses it when an item activates", async () => {
    const activations: string[] = []
    await mount(shell({ mobile: true }, () => activations.push("search")))
    expect(document.body.querySelector("aside")).toBeNull()
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => button("Open navigation")?.click())
    const dialog = document.body.querySelector('[role="dialog"]')
    expect(dialog?.getAttribute("data-slot")).toBe("navigation-panel")
    expect(button("Close navigation")).not.toBeNull()
    const search = [...(dialog?.querySelectorAll("button") ?? [])].find((element) => element.textContent === "Search")
    await act(async () => search?.click())
    expect(activations).toEqual(["search"])
    expect(document.body.querySelector('[role="dialog"]')?.hasAttribute("data-open") ?? false).toBe(false)
  })

  test("starts with the drawer open on request", async () => {
    await mount(shell({ mobile: true, defaultNavigationOpen: true }))
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
  })

  test("requires a shell around navigation items", () => {
    expect(() => renderToStaticMarkup(<ApplicationShell.NavigationItem label="Home" />)).toThrow(
      "ApplicationShell.useNavigation must be used within ApplicationShell.Root",
    )
  })
})

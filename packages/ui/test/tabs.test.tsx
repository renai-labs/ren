import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Tabs } from "../src/components/tabs.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

const views = (value: string | null, onValueChange: (value: string) => void) => (
  <Tabs.Root value={value} onValueChange={onValueChange}>
    <Tabs.List label="Usage views">
      <Tabs.Tab value="overview">Overview</Tabs.Tab>
      <Tabs.Tab value="sessions" count={4}>
        Per session
      </Tabs.Tab>
    </Tabs.List>
    <Tabs.Panel value="overview">Spend this month</Tabs.Panel>
    <Tabs.Panel value="sessions">Spend by session</Tabs.Panel>
  </Tabs.Root>
)

const mount = async (element: ReactElement) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(element))
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Tabs", () => {
  test("renders a labelled tab list with the current tab selected", () => {
    const body = html(renderToStaticMarkup(views("sessions", () => undefined)))
    expect(body.querySelector('[role="tablist"]')?.getAttribute("aria-label")).toBe("Usage views")
    const tabs = [...body.querySelectorAll('[role="tab"]')]
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Overview", "Per session4"])
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "true"])
  })

  test("selects no tab when the value is null", () => {
    const tabs = html(renderToStaticMarkup(views(null, () => undefined))).querySelectorAll('[role="tab"]')
    expect([...tabs].map((tab) => tab.getAttribute("aria-selected"))).toEqual(["false", "false"])
  })

  test("reports the clicked tab and shows its panel", async () => {
    const chosen: string[] = []
    await mount(views("overview", (value) => chosen.push(value)))
    const panels = () =>
      [...document.body.querySelectorAll('[role="tabpanel"]')].filter((panel) => !panel.hasAttribute("hidden"))
    expect(panels().map((panel) => panel.textContent)).toEqual(["Spend this month"])
    await act(async () => document.body.querySelectorAll<HTMLElement>('[role="tab"]')[1]?.click())
    expect(chosen).toEqual(["sessions"])
  })

  test("renders navigation tabs as the given links", () => {
    const body = html(
      renderToStaticMarkup(
        <Tabs.Navigation label="Project pages">
          <Tabs.Link render={<a href="/overview" aria-current="page" />}>Overview</Tabs.Link>
          <Tabs.Link render={<a href="/tasks" />} count={2}>
            Tasks
          </Tabs.Link>
        </Tabs.Navigation>,
      ),
    )
    expect(body.querySelector("nav")?.getAttribute("aria-label")).toBe("Project pages")
    expect(body.querySelector('[role="tablist"]')).toBeNull()
    const links = [...body.querySelectorAll("a")]
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/overview", "/tasks"])
    expect(links.map((link) => link.getAttribute("aria-current"))).toEqual(["page", null])
    expect(links.map((link) => link.textContent)).toEqual(["Overview", "Tasks2"])
  })
})

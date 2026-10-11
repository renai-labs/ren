import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Combobox } from "../src/components/combobox.js"
import { Select } from "../src/components/select.js"

const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
  return document.body
}

const people = [
  { value: "ada", label: "Ada Lovelace", description: "ada@ren.dev" },
  { value: "alan", label: "Alan Turing" },
  { value: "grace", label: "Grace Hopper", disabled: true },
]

const options = (body: HTMLElement) => [...body.querySelectorAll('[role="option"]')]

describe("Combobox", () => {
  test("labels the search input and lists every option inline", async () => {
    const body = await mount(<Combobox.Inline label="User" searchPlaceholder="Search people" items={people} />)
    const input = body.querySelector("input")
    expect(input?.getAttribute("aria-label")).toBe("User")
    expect(input?.getAttribute("placeholder")).toBe("Search people")
    expect(body.querySelector('[role="listbox"]')).not.toBeNull()
    expect(options(body).map((option) => option.textContent)).toEqual([
      "Ada Lovelaceada@ren.dev",
      "Alan Turing",
      "Grace Hopper",
    ])
    expect(options(body)[2]?.hasAttribute("data-disabled")).toBe(true)
    expect(body.querySelector('[data-slot="option-list"]')).not.toBeNull()
  })

  test("marks the selected option", async () => {
    const body = await mount(<Combobox.Inline label="User" items={people} defaultValue="alan" />)
    expect(options(body).map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true", "false"])
  })

  test("marks every selected option in multiple selection", async () => {
    const body = await mount(
      <Combobox.Inline label="User" items={people} selection="multiple" value={["ada", "alan"]} />,
    )
    expect(options(body).map((option) => option.getAttribute("aria-selected"))).toEqual(["true", "true", "false"])
  })

  test("labels groups", async () => {
    const body = await mount(
      <Combobox.Inline
        label="Search"
        groups={[
          { value: "teams", label: "Teams", items: [{ value: "design", label: "Design" }] },
          { value: "projects", label: "Projects", items: [{ value: "launch", label: "Launch plan" }] },
        ]}
      />,
    )
    const groups = [...body.querySelectorAll('[role="group"]')]
    expect(groups.length).toBe(2)
    expect(groups.map((group) => group.getAttribute("aria-labelledby") !== null)).toEqual([true, true])
    expect(body.textContent).toContain("Teams")
  })

  test("filters options by the controlled query and keywords", async () => {
    const body = await mount(
      <Combobox.Inline
        label="User"
        query="lovelace@"
        items={[
          { value: "ada", label: "Ada", keywords: ["lovelace@ren.dev"] },
          { value: "alan", label: "Alan" },
        ]}
      />,
    )
    expect(options(body).map((option) => option.textContent)).toEqual(["Ada"])
  })

  test("leaves filtering to the caller when filtering is external", async () => {
    const body = await mount(<Combobox.Inline label="User" query="zzz" filtering="external" items={people} />)
    expect(options(body).length).toBe(3)
  })

  test("shows the empty message without options", async () => {
    const body = await mount(<Combobox.Inline label="User" items={[]} emptyMessage="Nobody matches." />)
    expect(body.textContent).toContain("Nobody matches.")
  })

  test("shows loading and failure states in place of options", async () => {
    const loading = await mount(<Combobox.Inline label="User" items={people} state="loading" />)
    expect(loading.querySelector("output")?.getAttribute("aria-label")).toBe("Loading")
    expect(options(loading).length).toBe(0)
    act(() => mounted.splice(0).forEach((root) => root.unmount()))
    const failed = await mount(
      <Combobox.Inline label="User" items={people} state="failed" failureMessage="Couldn’t load teams." />,
    )
    expect(failed.querySelector('[role="alert"]')?.textContent).toBe("Couldn’t load teams.")
  })

  test("renders the panel without the inline frame chrome", async () => {
    const body = await mount(<Combobox.Panel label="Search" items={people} />)
    expect(body.querySelector('[data-slot="option-list"]')).not.toBeNull()
    expect(options(body).length).toBe(3)
  })

  test("renders only the trigger while the popover is closed", async () => {
    const body = await mount(
      <Combobox.Popover label="User" items={people} trigger={<Select.Button label="Members" placeholder="Add" />} />,
    )
    expect(body.querySelector("button")?.getAttribute("aria-label")).toBe("Members")
    expect(body.querySelector('[data-slot="option-list"]')).toBeNull()
  })

  test("opens the popover with its options", async () => {
    const body = await mount(
      <Combobox.Popover
        label="User"
        items={people}
        defaultOpen
        trigger={<Select.Button label="Members" placeholder="Add" />}
      />,
    )
    expect(body.querySelector('[data-slot="option-list"]')?.getAttribute("aria-label")).toBe("User")
    expect(body.querySelector("button")?.hasAttribute("data-popup-open")).toBe(true)
    expect(options(body).length).toBe(3)
  })
})

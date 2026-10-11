import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Button } from "../src/components/button.js"
import { Icon } from "../src/components/icon.js"
import { Menu } from "../src/components/menu.js"

const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

const open = (children: ReactNode) =>
  mount(
    <Menu.Root defaultOpen>
      <Menu.Trigger render={<Button appearance="outline">Options</Button>} />
      <Menu.Popup>{children}</Menu.Popup>
    </Menu.Root>,
  )

const items = (role: string) => [...document.body.querySelectorAll(`[role="${role}"]`)]

describe("Menu", () => {
  test("renders the trigger closed by default", async () => {
    await mount(
      <Menu.Root>
        <Menu.Trigger render={<Button appearance="outline">Options</Button>} />
        <Menu.Popup>
          <Menu.Item>Rename</Menu.Item>
        </Menu.Popup>
      </Menu.Root>,
    )
    const trigger = document.body.querySelector("button")
    expect(trigger?.dataset["slot"]).toBe("button")
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })

  test("renders items, marks, details and shortcuts while open", async () => {
    await open(
      <>
        <Menu.Item icon={<Icon glyph="Pencil" />} shortcut="⌘R">
          Rename
        </Menu.Item>
        <Menu.Item selected>Dark</Menu.Item>
        <Menu.Item detail="Fast" disabled>
          Haiku
        </Menu.Item>
      </>,
    )
    const menu = document.body.querySelector('[role="menu"]')
    expect(menu?.getAttribute("data-slot")).toBe("menu")
    const rows = items("menuitem")
    expect(rows.map((row) => row.textContent)).toEqual(["Rename⌘R", "Dark", "HaikuFast"])
    expect(rows[1]?.getAttribute("aria-checked")).toBe("true")
    expect(rows[0]?.hasAttribute("aria-checked")).toBe(false)
    expect(rows[2]?.getAttribute("aria-disabled")).toBe("true")
  })

  test("calls onSelect when an item is clicked", async () => {
    const selected: string[] = []
    await open(<Menu.Item onSelect={() => selected.push("rename")}>Rename</Menu.Item>)
    await act(async () => items("menuitem")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(selected).toEqual(["rename"])
  })

  test("renders checkbox and radio items with their checked state", async () => {
    await open(
      <>
        <Menu.CheckboxItem checked onCheckedChange={() => undefined}>
          Mon
        </Menu.CheckboxItem>
        <Menu.CheckboxItem checked={false} onCheckedChange={() => undefined}>
          Tue
        </Menu.CheckboxItem>
        <Menu.RadioGroup value="created" onValueChange={() => undefined}>
          <Menu.RadioItem value="updated">Last updated</Menu.RadioItem>
          <Menu.RadioItem value="created">Created</Menu.RadioItem>
        </Menu.RadioGroup>
      </>,
    )
    expect(items("menuitemcheckbox").map((row) => row.getAttribute("aria-checked"))).toEqual(["true", "false"])
    expect(items("menuitemradio").map((row) => row.getAttribute("aria-checked"))).toEqual(["false", "true"])
  })

  test("labels sections and separates groups", async () => {
    await open(
      <>
        <Menu.Section label="Session">
          <Menu.Item>Rename</Menu.Item>
        </Menu.Section>
        <Menu.Separator />
        <Menu.Message>No models found</Menu.Message>
      </>,
    )
    const group = document.body.querySelector('[role="group"]')
    const label = document.body.querySelector(`[id="${group?.getAttribute("aria-labelledby") ?? ""}"]`)
    expect(label?.textContent).toBe("Session")
    expect(items("separator").length).toBe(1)
    expect(document.body.querySelector('[role="menu"]')?.textContent).toContain("No models found")
  })

  test("marks a submenu trigger", async () => {
    await open(
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger detail="Inbox" current>
          Move to
        </Menu.SubmenuTrigger>
        <Menu.SubmenuPopup>
          <Menu.Item>Inbox</Menu.Item>
        </Menu.SubmenuPopup>
      </Menu.SubmenuRoot>,
    )
    const trigger = items("menuitem")[0]
    expect(trigger?.getAttribute("aria-haspopup")).toBe("menu")
    expect(trigger?.hasAttribute("data-current")).toBe(true)
    expect(trigger?.textContent).toBe("Move toInbox")
  })

  test("labels the search field with its placeholder", async () => {
    await open(<Menu.Search value="cl" onValueChange={() => undefined} placeholder="Search models" />)
    const input = document.body.querySelector("input")
    expect(input?.getAttribute("aria-label")).toBe("Search models")
    expect(input?.value).toBe("cl")
  })
})

import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ComponentProps, ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Menu } from "../src/components/menu.js"
import { Table } from "../src/components/table.js"
import type { TableSortDirection } from "../src/components/table.js"

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

const members = (props: Omit<ComponentProps<typeof Table.Root>, "children">) => (
  <Table.Root caption="Members" {...props}>
    <Table.Header>
      <Table.HeaderCell>Name</Table.HeaderCell>
      <Table.HeaderCell alignment="end">Seats</Table.HeaderCell>
    </Table.Header>
    <Table.Body>
      <Table.Row>
        <Table.Cell>Ada Lovelace</Table.Cell>
        <Table.Cell alignment="end">12</Table.Cell>
      </Table.Row>
    </Table.Body>
  </Table.Root>
)

describe("Table", () => {
  test("renders a captioned table with column headers and cells", () => {
    const body = html(renderToStaticMarkup(members({})))
    expect(body.querySelector("[data-slot='table'] caption")?.textContent).toBe("Members")
    expect([...body.querySelectorAll("th")].map((cell) => cell.getAttribute("scope"))).toEqual(["col", "col"])
    expect(body.querySelector("td")?.getAttribute("title")).toBe("Ada Lovelace")
  })

  test("shows the header and a loading message while loading", () => {
    const body = html(renderToStaticMarkup(members({ state: "loading" })))
    expect(body.querySelectorAll("th")).toHaveLength(2)
    expect(body.querySelector("tbody")).toBeNull()
    expect(body.querySelector("output[data-state='loading']")).not.toBeNull()
  })

  test("shows the failure with a retry", () => {
    const body = html(
      renderToStaticMarkup(members({ state: "failed", failureMessage: "No luck.", onRetry: () => undefined })),
    )
    expect(body.querySelector("tbody")).toBeNull()
    expect(body.querySelector("[role='alert']")?.textContent).toContain("No luck.")
    expect(body.querySelector("[role='alert'] button")?.textContent).toBe("Try again")
  })

  test("replaces the table with an empty message", () => {
    const body = html(renderToStaticMarkup(members({ state: "empty", emptyMessage: "No members yet." })))
    expect(body.querySelector("table")).toBeNull()
    expect(body.querySelector("[data-state='empty']")?.textContent).toBe("No members yet.")
  })

  test("marks the sorted column and flips its direction", async () => {
    const changes: TableSortDirection[] = []
    const sortable = (direction: TableSortDirection | undefined) => (
      <Table.Root>
        <Table.Header>
          <Table.SortableHeaderCell direction={direction} onSortChange={(next) => changes.push(next)}>
            Name
          </Table.SortableHeaderCell>
        </Table.Header>
      </Table.Root>
    )
    const container = await mount(sortable("ascending"))
    expect(container.querySelector("th")?.getAttribute("aria-sort")).toBe("ascending")
    await act(async () => container.querySelector("button")?.click())
    expect(changes).toEqual(["descending"])
    const unsorted = await mount(sortable(undefined))
    expect(unsorted.querySelector("th")?.hasAttribute("aria-sort")).toBe(false)
    await act(async () => unsorted.querySelector("button")?.click())
    expect(changes).toEqual(["descending", "ascending"])
  })

  test("activates a row by click and keyboard", async () => {
    const activations: string[] = []
    const container = await mount(
      <Table.Root>
        <Table.Body>
          <Table.Row onActivate={() => activations.push("ada")}>
            <Table.Cell>Ada</Table.Cell>
            <Table.RowActions label="Member actions">
              <Menu.Item>Remove</Menu.Item>
            </Table.RowActions>
          </Table.Row>
        </Table.Body>
      </Table.Root>,
    )
    const row = container.querySelector("tr")
    expect(row?.getAttribute("tabindex")).toBe("0")
    await act(async () => row?.click())
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
    await act(async () => row?.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true })))
    expect(activations).toEqual(["ada", "ada", "ada"])
    const actions = container.querySelector("button")
    expect(actions?.getAttribute("aria-label")).toBe("Member actions")
    await act(async () => actions?.click())
    expect(activations).toHaveLength(3)
  })

  test("leaves a row's actions cell blank without actions", () => {
    const body = html(
      renderToStaticMarkup(
        <Table.Root>
          <Table.Body>
            <Table.Row>
              <Table.RowActions label="Member actions">{null}</Table.RowActions>
            </Table.Row>
          </Table.Body>
        </Table.Root>,
      ),
    )
    expect(body.querySelectorAll("td")).toHaveLength(1)
    expect(body.querySelector("button")).toBeNull()
    expect(body.querySelector("tr")?.hasAttribute("tabindex")).toBe(false)
  })
})

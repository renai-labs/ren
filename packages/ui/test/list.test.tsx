import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactElement } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { List } from "../src/components/list.js"

const html = (element: ReactElement) => new DOMParser().parseFromString(renderToStaticMarkup(element), "text/html").body
const mounted: Root[] = []

const mount = async (element: ReactElement) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(element))
}

const click = (selector: string) => act(async () => document.body.querySelector<HTMLElement>(selector)?.click())

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("List.Root", () => {
  test("renders a labelled list of static rows", () => {
    const body = html(
      <List.Root label="Files">
        <List.Item title="README.md" description="Updated today" />
      </List.Root>,
    )
    const list = body.querySelector('[role="list"]')
    expect(list?.getAttribute("aria-label")).toBe("Files")
    expect(list?.querySelector('[role="listitem"]')?.textContent).toBe("README.mdUpdated today")
  })

  test("replaces the rows with a loading, empty or failed message", () => {
    const loading = html(<List.Root label="Files" state="loading" />)
    expect(loading.querySelector('[role="list"]')).toBeNull()
    expect(loading.querySelector('[data-state="loading"]')).not.toBeNull()
    expect(html(<List.Root state="empty" emptyMessage="No files yet." />).textContent).toBe("No files yet.")
    const failed = html(<List.Root state="failed" failureMessage="Couldn't load files." onRetry={() => undefined} />)
    expect(failed.querySelector('[role="alert"]')?.textContent).toContain("Couldn't load files.")
    expect(failed.querySelector("button")?.textContent).toBe("Try again")
  })
})

describe("List.Item", () => {
  test("wraps an activatable row in a list item and reports pressed selection", async () => {
    const activations: string[] = []
    await mount(<List.Item title="README.md" selected label="Open README" onActivate={() => activations.push("row")} />)
    const button = document.body.querySelector('[role="listitem"] > button')
    expect(button?.getAttribute("aria-label")).toBe("Open README")
    expect(button?.getAttribute("aria-pressed")).toBe("true")
    await click('[role="listitem"] > button')
    expect(activations).toEqual(["row"])
  })

  test("exposes radio rows as checked radios", () => {
    const body = html(
      <List.Item title="README.md" selectionMark="radio" selected={false} onActivate={() => undefined} />,
    )
    const radio = body.querySelector('[role="radio"]')
    expect(radio?.getAttribute("aria-checked")).toBe("false")
    expect(radio?.querySelector('[data-slot="selection-mark"]')).not.toBeNull()
  })

  test("marks the current link row", () => {
    const body = html(<List.Item title="README.md" selected render={<a href="/files/readme" />} />)
    const link = body.querySelector("a")
    expect(link?.getAttribute("href")).toBe("/files/readme")
    expect(link?.getAttribute("aria-current")).toBe("page")
  })

  test("disables a row", () => {
    const body = html(<List.Item title="README.md" disabled onActivate={() => undefined} />)
    expect(body.querySelector("button")?.hasAttribute("disabled")).toBe(true)
  })

  test("keeps an action click from activating the row", async () => {
    const clicks: string[] = []
    await mount(
      <List.Item
        title="README.md"
        onActivate={() => clicks.push("row")}
        actions={
          <button type="button" data-action="" onClick={() => clicks.push("action")}>
            Remove
          </button>
        }
      />,
    )
    expect(document.body.querySelector('[role="listitem"] > button')?.textContent).toBe("README.md")
    await click("[data-action]")
    expect(clicks).toEqual(["action"])
  })
})

describe("List.DisclosureItem", () => {
  test("toggles its panel", async () => {
    await mount(
      <List.DisclosureItem title="GitHub" label="GitHub credentials">
        <span data-detail="">Token</span>
      </List.DisclosureItem>,
    )
    const trigger = document.body.querySelector('[aria-label="GitHub credentials"]')
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    await click('[aria-label="GitHub credentials"]')
    expect(trigger?.getAttribute("aria-expanded")).toBe("true")
    expect(document.body.querySelector("[data-detail]")).not.toBeNull()
  })

  test("ignores toggles while locked", async () => {
    const changes: boolean[] = []
    await mount(
      <List.DisclosureItem title="GitHub" label="GitHub" open locked onOpenChange={(open) => changes.push(open)}>
        Token
      </List.DisclosureItem>,
    )
    await click('[aria-label="GitHub"]')
    expect(changes).toEqual([])
    expect(document.body.querySelector('[aria-label="GitHub"]')?.getAttribute("aria-expanded")).toBe("true")
  })
})

describe("transcript rows", () => {
  test("renders an activatable transcript row as a button", () => {
    const body = html(<List.TranscriptItem title="Ran tests" label="Show test run" onActivate={() => undefined} />)
    expect(body.querySelector("button")?.getAttribute("aria-label")).toBe("Show test run")
    expect(html(<List.TranscriptItem appearance="event" title="Created" />).querySelector("button")).toBeNull()
  })

  test("keeps actions between a named trigger and a pointer-only trigger", () => {
    const body = html(
      <List.TranscriptDisclosure
        title="Edited list.tsx"
        label="Edited list.tsx"
        actions={<button type="button">Copy</button>}
      >
        Diff
      </List.TranscriptDisclosure>,
    )
    const triggers = [...body.querySelectorAll("[aria-expanded]")]
    expect(triggers.map((trigger) => trigger.getAttribute("aria-label"))).toEqual(["Edited list.tsx", null])
    expect(triggers.at(1)?.getAttribute("aria-hidden")).toBe("true")
    expect(triggers.at(1)?.getAttribute("tabindex")).toBe("-1")
  })
})

describe("List.Group", () => {
  test("collapses its rows from the header button", async () => {
    await mount(
      <List.Group label="In progress" title="In progress">
        <span data-row="">Task</span>
      </List.Group>,
    )
    expect(document.body.querySelector("section")?.getAttribute("aria-label")).toBe("In progress")
    expect(document.body.querySelector("h2")?.textContent).toBe("In progress")
    await click('[aria-label="Collapse In progress"]')
    expect(document.body.querySelector('[aria-label="Expand In progress"]')?.getAttribute("aria-expanded")).toBe(
      "false",
    )
  })
})

describe("List.Virtual", () => {
  const items = Array.from({ length: 1000 }, (_, index) => ({ id: `item-${index}`, title: `Item ${index}` }))

  test("renders a labelled list without mounting every item", async () => {
    await mount(
      <List.Virtual
        label="Sessions"
        items={items}
        itemKey={(item) => item.id}
        estimateSize={40}
        // oxlint-disable-next-line ren/no-render-props -- the virtualized list hands each item back
        renderItem={(item) => <List.Item title={item.title} />}
      />,
    )
    expect(document.body.querySelector('[role="list"]')?.getAttribute("aria-label")).toBe("Sessions")
    expect(document.body.querySelectorAll('[role="listitem"]').length).toBeLessThan(items.length)
  })

  test("shows the empty message when there are no items", () => {
    const body = html(
      <List.Virtual
        label="Sessions"
        items={[]}
        itemKey={(item: { id: string }) => item.id}
        estimateSize={40}
        emptyMessage="No sessions yet."
        // oxlint-disable-next-line ren/no-render-props -- the virtualized list hands each item back
        renderItem={() => null}
      />,
    )
    expect(body.querySelector('[role="list"]')).toBeNull()
    expect(body.textContent).toBe("No sessions yet.")
  })
})

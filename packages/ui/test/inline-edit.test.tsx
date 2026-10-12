import { afterEach, describe, expect, test } from "bun:test"
import { act, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { InlineEdit } from "../src/components/inline-edit.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []

function Editable(props: {
  initial: string
  commits: string[]
  required?: boolean
  validate?: (value: string) => string | null
  failure?: string
}) {
  const [value, setValue] = useState(props.initial)
  return (
    <InlineEdit
      label="Name"
      value={value}
      required={props.required}
      validate={props.validate}
      onCommit={(next) => {
        props.commits.push(next)
        if (props.failure !== undefined) return Promise.reject(new Error(props.failure))
        setValue(next)
        return undefined
      }}
    />
  )
}

const mount = async (props: Parameters<typeof Editable>[0]) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(<Editable {...props} />))
  await act(async () => container.querySelector("button")?.click())
  return container
}

const type = async (container: HTMLElement, value: string) => {
  const input = container.querySelector("input")
  if (input === null) throw new Error("No input")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  return input
}

const press = (element: Element, key: string) =>
  act(async () => element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })))

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("InlineEdit", () => {
  test("shows the value behind a labelled edit button", () => {
    const body = html(renderToStaticMarkup(<InlineEdit label="Name" value="Ada" onCommit={() => undefined} />))
    expect(body.querySelector("button")?.getAttribute("aria-label")).toBe("Edit Name")
    expect(body.textContent).toBe("Ada")
  })

  test("shows the placeholder when empty", () => {
    const body = html(
      renderToStaticMarkup(<InlineEdit label="Name" value="" placeholder="Add a name" onCommit={() => undefined} />),
    )
    expect(body.querySelector("[data-placeholder]")?.textContent).toBe("Add a name")
  })

  test("edits in a focused, labelled field", async () => {
    const container = await mount({ initial: "Ada", commits: [] })
    const input = container.querySelector("input")
    expect(input?.getAttribute("aria-label")).toBe("Name")
    expect(input?.value).toBe("Ada")
    expect(document.activeElement).toBe(input)
  })

  test("commits the trimmed draft on Enter", async () => {
    const commits: string[] = []
    const container = await mount({ initial: "Ada", commits })
    await press(await type(container, "  Grace "), "Enter")
    expect(commits).toEqual(["Grace"])
    expect(container.querySelector("input")).toBeNull()
    expect(container.textContent).toBe("Grace")
  })

  test("cancels on Escape", async () => {
    const commits: string[] = []
    const container = await mount({ initial: "Ada", commits })
    await press(await type(container, "Grace"), "Escape")
    expect(commits).toEqual([])
    expect(container.textContent).toBe("Ada")
  })

  test("commits on blur", async () => {
    const commits: string[] = []
    const container = await mount({ initial: "Ada", commits })
    const input = await type(container, "Grace")
    await act(async () => input.blur())
    expect(commits).toEqual(["Grace"])
  })

  test("skips the commit for an unchanged or missing required value", async () => {
    const commits: string[] = []
    const unchanged = await mount({ initial: "Ada", commits })
    await press(await type(unchanged, "Ada "), "Enter")
    const required = await mount({ initial: "Ada", commits, required: true })
    await press(await type(required, "  "), "Enter")
    expect(commits).toEqual([])
    expect(required.textContent).toBe("Ada")
  })

  test("returns focus to the edit button after Enter or Escape", async () => {
    const committed = await mount({ initial: "Ada", commits: [] })
    await press(await type(committed, "Grace"), "Enter")
    expect(document.activeElement).toBe(committed.querySelector("button"))
    const cancelled = await mount({ initial: "Ada", commits: [] })
    await press(await type(cancelled, "Grace"), "Escape")
    expect(document.activeElement).toBe(cancelled.querySelector("button"))
  })

  test("leaves focus where it went after a blur commit", async () => {
    const container = await mount({ initial: "Ada", commits: [] })
    const input = await type(container, "Grace")
    await act(async () => input.blur())
    expect(container.textContent).toBe("Grace")
    expect(document.activeElement).not.toBe(container.querySelector("button"))
  })

  test("shows a validation error on the field until the user types", async () => {
    const commits: string[] = []
    const container = await mount({ initial: "Ada", commits, validate: () => "Too short." })
    const input = await type(container, "A")
    await press(input, "Enter")
    expect(commits).toEqual([])
    expect(input.getAttribute("aria-invalid")).toBe("true")
    const description = container.querySelector("[data-slot='text']")
    expect(description?.id).toBe(input.getAttribute("aria-describedby") ?? "")
    expect(description?.textContent).toBe("Too short.")
    await type(container, "Al")
    expect(input.hasAttribute("aria-invalid")).toBe(false)
    expect(input.hasAttribute("aria-describedby")).toBe(false)
    expect(container.textContent).toBe("")
  })

  test("shows a save error while editing and drops it on Escape", async () => {
    const commits: string[] = []
    const container = await mount({ initial: "Ada", commits, failure: "Name taken." })
    const input = await type(container, "Grace")
    await press(input, "Enter")
    expect(commits).toEqual(["Grace"])
    expect(input.disabled).toBe(false)
    expect(input.getAttribute("aria-invalid")).toBe("true")
    expect(container.textContent).toBe("Name taken.")
    await press(input, "Escape")
    expect(container.textContent).toBe("Ada")
  })
})

import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { Select } from "../src/components/select.js"

const html = (markup: string) => new DOMParser().parseFromString(markup, "text/html").body
const mounted: Root[] = []
const options = [
  { value: "sonnet", label: "Claude Sonnet" },
  { value: "opus", label: "Claude Opus" },
]

const mount = async (node: ReactNode) => {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  mounted.push(root)
  await act(async () => root.render(node))
}

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Select.Root", () => {
  test("renders a labelled combobox showing the selected option", () => {
    const trigger = html(
      renderToStaticMarkup(<Select.Root label="Model" value="opus" options={options} />),
    ).querySelector('[role="combobox"]')
    expect(trigger?.getAttribute("aria-label")).toBe("Model")
    expect(trigger?.getAttribute("data-slot")).toBe("select")
    expect(trigger?.getAttribute("aria-expanded")).toBe("false")
    expect(trigger?.textContent).toBe("Claude Opus")
  })

  test("shows the placeholder without a value", () => {
    const trigger = html(
      renderToStaticMarkup(<Select.Root label="Model" placeholder="Choose a model" options={options} />),
    ).querySelector('[role="combobox"]')
    expect(trigger?.textContent).toBe("Choose a model")
    expect(trigger?.hasAttribute("data-placeholder")).toBe(true)
  })

  test("disables the trigger", () => {
    const trigger = html(renderToStaticMarkup(<Select.Root label="Model" options={options} disabled />)).querySelector(
      '[role="combobox"]',
    )
    expect(trigger?.hasAttribute("data-disabled")).toBe(true)
  })

  test("lists the options while open and marks the selected one", async () => {
    await mount(<Select.Root label="Model" value="opus" options={options} defaultOpen />)
    const items = [...document.body.querySelectorAll('[role="option"]')]
    expect(items.map((item) => item.textContent)).toEqual(["Claude Sonnet", "Claude Opus"])
    expect(items.map((item) => item.getAttribute("aria-selected"))).toEqual(["false", "true"])
    expect(document.body.querySelector('[role="combobox"]')?.getAttribute("aria-expanded")).toBe("true")
  })

  test("reports the chosen option", async () => {
    const chosen: string[] = []
    await mount(
      <Select.Root label="Model" options={options} onValueChange={(value) => chosen.push(value)} defaultOpen />,
    )
    const item = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].at(-1)
    await act(async () => item?.click())
    expect(chosen).toEqual(["opus"])
  })

  test("submits the value through a hidden input", () => {
    const input = html(
      renderToStaticMarkup(<Select.Root label="Model" name="model" value="opus" options={options} />),
    ).querySelector('input[name="model"]')
    expect(input?.getAttribute("value")).toBe("opus")
  })

  test("takes its label and invalid state from a Base UI field", async () => {
    await mount(
      <Field.Root invalid>
        <Field.Label id="model-label" nativeLabel={false} render={<div />}>
          Model
        </Field.Label>
        <Select.Root options={options} />
      </Field.Root>,
    )
    const trigger = document.body.querySelector('[role="combobox"]')
    expect(trigger?.getAttribute("aria-labelledby")).toBe("model-label")
    expect(trigger?.getAttribute("aria-invalid")).toBe("true")
    expect(trigger?.hasAttribute("data-invalid")).toBe(true)
  })
})

describe("Select.Button", () => {
  test("renders a labelled button with its value", () => {
    const button = html(renderToStaticMarkup(<Select.Button label="Due date">Tomorrow</Select.Button>)).querySelector(
      "button",
    )
    expect(button?.getAttribute("type")).toBe("button")
    expect(button?.getAttribute("aria-label")).toBe("Due date")
    expect(button?.getAttribute("data-slot")).toBe("select")
    expect(button?.hasAttribute("data-placeholder")).toBe(false)
    expect(button?.textContent).toBe("Tomorrow")
  })

  test("shows the placeholder without a value", () => {
    const button = html(
      renderToStaticMarkup(<Select.Button label="Due date" placeholder="Pick a date" />),
    ).querySelector("button")
    expect(button?.hasAttribute("data-placeholder")).toBe(true)
    expect(button?.textContent).toBe("Pick a date")
  })

  test("marks itself invalid", () => {
    const button = html(renderToStaticMarkup(<Select.Button label="Due date" invalid />)).querySelector("button")
    expect(button?.hasAttribute("data-invalid")).toBe(true)
  })

  test("passes button props through for popup triggers", () => {
    const button = html(
      renderToStaticMarkup(<Select.Button label="Due date" disabled aria-haspopup="dialog" />),
    ).querySelector("button")
    expect(button?.hasAttribute("disabled")).toBe(true)
    expect(button?.getAttribute("aria-haspopup")).toBe("dialog")
  })
})

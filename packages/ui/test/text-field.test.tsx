import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { TextField } from "../src/components/text-field.js"

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

describe("TextField", () => {
  test("renders a text input inside its surface", () => {
    const body = html(renderToStaticMarkup(<TextField aria-label="Project name" placeholder="Quarterly planning" />))
    const input = body.querySelector("input")
    expect(body.querySelector('[data-slot="text-field"]')?.contains(input ?? null)).toBe(true)
    expect(input?.dataset["slot"]).toBe("text-field-input")
    expect(input?.getAttribute("aria-label")).toBe("Project name")
    expect(input?.getAttribute("placeholder")).toBe("Quarterly planning")
    expect(input?.hasAttribute("aria-invalid")).toBe(false)
  })

  test("passes the input type and disabled state through", () => {
    const input = html(renderToStaticMarkup(<TextField aria-label="Email" type="email" disabled />)).querySelector(
      "input",
    )
    expect(input?.getAttribute("type")).toBe("email")
    expect(input?.hasAttribute("disabled")).toBe(true)
  })

  test("marks itself invalid on its own", () => {
    const input = html(renderToStaticMarkup(<TextField aria-label="Email" invalid />)).querySelector("input")
    expect(input?.getAttribute("aria-invalid")).toBe("true")
  })

  test("renders leading and trailing content beside the input", () => {
    const body = html(
      renderToStaticMarkup(<TextField aria-label="Email" leading={<b>lead</b>} trailing={<i>trail</i>} />),
    )
    const surface = body.querySelector('[data-slot="text-field"]')
    expect([...(surface?.children ?? [])].map((child) => child.textContent || child.tagName)).toEqual([
      "lead",
      "INPUT",
      "trail",
    ])
  })

  test("takes its label, description and invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <Field.Label>Project name</Field.Label>
        <TextField />
        <Field.Description>Shown on the dashboard</Field.Description>
      </Field.Root>,
    )
    const input = container.querySelector("input")
    const label = container.querySelector("label")
    const description = container.querySelector("p")
    expect(input?.id).not.toBe("")
    expect(label?.getAttribute("for")).toBe(input?.id ?? "")
    expect(input?.getAttribute("aria-describedby")).toContain(description?.id ?? "missing")
    expect(input?.getAttribute("aria-invalid")).toBe("true")
  })

  test("offers suggestions through an autocomplete input", async () => {
    const container = await mount(<TextField aria-label="Permission" suggestions={["bash", "edit"]} />)
    const input = container.querySelector("input")
    expect(input?.getAttribute("role")).toBe("combobox")
    expect(input?.getAttribute("aria-autocomplete")).toBe("list")
    expect(input?.dataset["slot"]).toBe("text-field-input")
  })
})

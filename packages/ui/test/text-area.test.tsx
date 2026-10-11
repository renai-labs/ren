import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { TextArea } from "../src/components/text-area.js"

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

describe("TextArea", () => {
  test("renders a textarea with its native attributes", () => {
    const textarea = html(
      renderToStaticMarkup(<TextArea aria-label="Description" rows={3} placeholder="Notes" defaultValue="Draft" />),
    ).querySelector("textarea")
    expect(textarea?.dataset["slot"]).toBe("text-area")
    expect(textarea?.getAttribute("aria-label")).toBe("Description")
    expect(textarea?.getAttribute("rows")).toBe("3")
    expect(textarea?.getAttribute("placeholder")).toBe("Notes")
    expect(textarea?.textContent).toBe("Draft")
    expect(textarea?.hasAttribute("aria-invalid")).toBe(false)
  })

  test("marks itself invalid on its own", () => {
    const textarea = html(renderToStaticMarkup(<TextArea aria-label="Description" invalid />)).querySelector("textarea")
    expect(textarea?.getAttribute("aria-invalid")).toBe("true")
  })

  test("passes the disabled state through", () => {
    const textarea = html(renderToStaticMarkup(<TextArea aria-label="Description" disabled />)).querySelector(
      "textarea",
    )
    expect(textarea?.hasAttribute("disabled")).toBe(true)
  })

  test("reports typed values through onChange", async () => {
    const values: string[] = []
    const container = await mount(
      <TextArea aria-label="Description" onChange={(event) => values.push(event.target.value)} />,
    )
    const textarea = container.querySelector("textarea")
    await act(async () => {
      if (textarea === null) return
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textarea, "Ship it")
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(values).toEqual(["Ship it"])
  })

  test("takes its label, description and invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <Field.Label>Description</Field.Label>
        <TextArea />
        <Field.Description>Shown on the project page</Field.Description>
      </Field.Root>,
    )
    const textarea = container.querySelector("textarea")
    expect(textarea?.id).not.toBe("")
    expect(container.querySelector("label")?.getAttribute("for")).toBe(textarea?.id ?? "")
    expect(textarea?.getAttribute("aria-describedby")).toContain(container.querySelector("p")?.id ?? "missing")
    expect(textarea?.getAttribute("aria-invalid")).toBe("true")
  })
})

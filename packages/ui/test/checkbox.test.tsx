import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Checkbox } from "../src/components/checkbox.js"

const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

const checkbox = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="checkbox"]')

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Checkbox", () => {
  test("names the box with an assistive label", async () => {
    const box = checkbox(await mount(<Checkbox label="Use PKCE" />))
    expect(box?.getAttribute("aria-label")).toBe("Use PKCE")
    expect(box?.dataset["slot"]).toBe("checkbox")
    expect(box?.getAttribute("aria-checked")).toBe("false")
  })

  test("reflects checked, indeterminate and disabled props", async () => {
    expect(checkbox(await mount(<Checkbox label="A" checked />))?.getAttribute("aria-checked")).toBe("true")
    expect(checkbox(await mount(<Checkbox label="B" indeterminate />))?.getAttribute("aria-checked")).toBe("mixed")
    expect(checkbox(await mount(<Checkbox label="C" disabled />))?.getAttribute("aria-disabled")).toBe("true")
  })

  test("prints a visible label and description that toggle the box", async () => {
    const changes: boolean[] = []
    const container = await mount(
      <Checkbox
        label="Use PKCE"
        labelVisibility="visible"
        description="Require a code challenge"
        onCheckedChange={(checked) => changes.push(checked)}
      />,
    )
    const label = container.querySelector("label")
    expect(checkbox(container)?.hasAttribute("aria-label")).toBe(false)
    expect(label?.textContent).toBe("Use PKCERequire a code challenge")
    await act(async () => label?.click())
    expect(changes).toEqual([true])
    expect(checkbox(container)?.getAttribute("aria-checked")).toBe("true")
  })

  test("reports the next checked state", async () => {
    const changes: boolean[] = []
    const container = await mount(
      <Checkbox label="Use PKCE" checked onCheckedChange={(checked) => changes.push(checked)} />,
    )
    await act(async () => checkbox(container)?.click())
    expect(changes).toEqual([false])
  })

  test("takes its label and invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <Field.Label>Use PKCE</Field.Label>
        <Checkbox />
      </Field.Root>,
    )
    const box = checkbox(container)
    const label = container.querySelector("label")
    expect(label?.id).not.toBe("")
    expect(box?.getAttribute("aria-labelledby")).toBe(label?.id ?? "")
    expect(box?.hasAttribute("data-invalid")).toBe(true)
  })
})

import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Switch } from "../src/components/switch.js"

const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

const control = (container: HTMLElement) => container.querySelector<HTMLElement>('[role="switch"]')

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("Switch", () => {
  test("renders a labelled, non-submitting switch button", async () => {
    const element = control(await mount(<Switch label="Build after creation" id="build" />))
    expect(element?.tagName).toBe("BUTTON")
    expect(element?.getAttribute("type")).toBe("button")
    expect(element?.id).toBe("build")
    expect(element?.getAttribute("aria-label")).toBe("Build after creation")
    expect(element?.dataset["slot"]).toBe("switch")
    expect(element?.getAttribute("aria-checked")).toBe("false")
  })

  test("reflects checked and disabled props", async () => {
    expect(control(await mount(<Switch label="A" checked />))?.getAttribute("aria-checked")).toBe("true")
    expect(control(await mount(<Switch label="B" disabled />))?.hasAttribute("disabled")).toBe(true)
  })

  test("reports the next checked state", async () => {
    const changes: boolean[] = []
    const container = await mount(<Switch label="Build" onCheckedChange={(checked) => changes.push(checked)} />)
    await act(async () => control(container)?.click())
    await act(async () => control(container)?.click())
    expect(changes).toEqual([true, false])
  })

  test("takes its label and invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <Field.Label>Build after creation</Field.Label>
        <Switch />
      </Field.Root>,
    )
    const element = control(container)
    const label = container.querySelector("label")
    expect(label?.getAttribute("for")).toBe(element?.id ?? "")
    expect(element?.hasAttribute("data-invalid")).toBe(true)
  })
})

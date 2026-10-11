import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { PasswordField } from "../src/components/password-field.js"

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

describe("PasswordField", () => {
  test("hides the value until the toggle reveals it", async () => {
    const container = await mount(<PasswordField aria-label="Password" defaultValue="hunter2" />)
    const input = container.querySelector("input")
    const toggle = container.querySelector("button")
    expect(input?.getAttribute("type")).toBe("password")
    expect(toggle?.getAttribute("aria-label")).toBe("Show password")
    expect(toggle?.getAttribute("aria-pressed")).toBe("false")
    await act(async () => toggle?.click())
    expect(input?.getAttribute("type")).toBe("text")
    expect(input?.value).toBe("hunter2")
    expect(toggle?.getAttribute("aria-label")).toBe("Hide password")
    expect(toggle?.getAttribute("aria-pressed")).toBe("true")
    await act(async () => toggle?.click())
    expect(input?.getAttribute("type")).toBe("password")
  })

  test("disables the toggle with the field", async () => {
    const container = await mount(<PasswordField aria-label="Password" disabled />)
    expect(container.querySelector("input")?.hasAttribute("disabled")).toBe(true)
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true)
  })

  test("marks itself invalid on its own", async () => {
    const container = await mount(<PasswordField aria-label="Password" invalid />)
    expect(container.querySelector("input")?.getAttribute("aria-invalid")).toBe("true")
  })

  test("takes its label and invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <Field.Label>Password</Field.Label>
        <PasswordField />
      </Field.Root>,
    )
    const input = container.querySelector("input")
    expect(container.querySelector("label")?.getAttribute("for")).toBe(input?.id ?? "missing")
    expect(input?.getAttribute("aria-invalid")).toBe("true")
  })
})

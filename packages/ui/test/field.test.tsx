import { Input } from "@base-ui/react/input"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { CodeField } from "../src/components/code-field.js"
import { Field } from "../src/components/field.js"

const mounted: Root[] = []

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

const describedBy = (container: HTMLElement) =>
  (container.querySelector("input")?.getAttribute("aria-describedby") ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => container.querySelector(`[id="${id}"]`)?.textContent)

describe("Field", () => {
  test("labels the control inside it", async () => {
    const container = await mount(
      <Field.Root label="Email">
        <Input />
      </Field.Root>,
    )
    const label = container.querySelector("label")
    const input = container.querySelector("input")
    expect(container.querySelector('[data-slot="field"]')).not.toBeNull()
    expect(label?.textContent).toBe("Email")
    expect(label?.htmlFor).toBe(input?.id ?? "missing")
    expect(input?.hasAttribute("aria-invalid")).toBe(false)
  })

  test("describes the control with its description", async () => {
    const container = await mount(
      <Field.Root label="Password" description="At least 8 characters">
        <Input />
      </Field.Root>,
    )
    expect(describedBy(container)).toEqual(["At least 8 characters"])
  })

  test("marks the control invalid and describes it with the error", async () => {
    const container = await mount(
      <Field.Root label="Email" description="We never share it" error="Enter a valid email">
        <Input />
      </Field.Root>,
    )
    const input = container.querySelector("input")
    expect(input?.getAttribute("aria-invalid")).toBe("true")
    expect(container.querySelector('[data-slot="field"]')?.hasAttribute("data-invalid")).toBe(true)
    expect(describedBy(container).toSorted()).toEqual(["Enter a valid email", "We never share it"])
    expect(container.querySelector('[aria-live="polite"]')?.textContent).toBe("Enter a valid email")
  })

  test("treats an empty error as valid", async () => {
    const container = await mount(
      <Field.Root label="Email" error="">
        <Input />
      </Field.Root>,
    )
    expect(container.querySelector("input")?.hasAttribute("aria-invalid")).toBe(false)
    expect(container.querySelector('[aria-live="polite"]')).toBeNull()
  })

  test("describes the control in side-by-side orientations", async () => {
    const container = await mount(
      <Field.Root label="Theme" description="Applies to every device" orientation="row">
        <Input />
      </Field.Root>,
    )
    expect(describedBy(container)).toEqual(["Applies to every device"])
  })

  test("shows the optional marker, the hint button and the label action", async () => {
    const container = await mount(
      <Field.Root label="Branch" necessity="optional" hint="Uses the default branch when empty" labelAction="Reset">
        <Input />
      </Field.Root>,
    )
    expect(container.textContent).toContain("Optional")
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("About branch")
    expect(container.textContent).toContain("Reset")
  })

  test("disables the control", async () => {
    const container = await mount(
      <Field.Root label="Email" disabled>
        <Input />
      </Field.Root>,
    )
    expect(container.querySelector("input")?.disabled).toBe(true)
  })

  test("labels a code field and marks its slots invalid", async () => {
    const container = await mount(
      <Field.Root label="Verification code" error="That code has expired">
        <CodeField length={4} />
      </Field.Root>,
    )
    const label = container.querySelector("label")
    const slots = [...container.querySelectorAll<HTMLInputElement>('[data-slot="code-field"] input')]
    expect(label?.htmlFor).toBe(slots[0]?.id ?? "missing")
    expect(slots.every((slot) => slot.getAttribute("aria-invalid") === "true")).toBe(true)
  })
})

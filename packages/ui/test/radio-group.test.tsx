import { Field } from "@base-ui/react/field"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { RadioGroup } from "../src/components/radio-group.js"

const mounted: Root[] = []

const mount = async (node: ReactNode) => {
  const container = document.body.appendChild(document.createElement("div"))
  const root = createRoot(container)
  mounted.push(root)
  await act(async () => root.render(node))
  return container
}

const items = (
  <>
    <RadioGroup.Item value="unrestricted" label="Unrestricted" description="Agents can reach any host." />
    <RadioGroup.Item value="limited" label="Limited" />
  </>
)

const radios = (container: HTMLElement) => [...container.querySelectorAll<HTMLElement>('[role="radio"]')]

afterEach(() => {
  mounted.splice(0).forEach((root) => act(() => root.unmount()))
  document.body.replaceChildren()
})

describe("RadioGroup", () => {
  test("labels the group and lists one radio per item", async () => {
    const container = await mount(<RadioGroup.Root label="Network access">{items}</RadioGroup.Root>)
    const group = container.querySelector<HTMLElement>('[role="radiogroup"]')
    expect(group?.getAttribute("aria-label")).toBe("Network access")
    expect(group?.dataset["slot"]).toBe("radio-group")
    expect(radios(container).map((radio) => radio.closest("label")?.textContent)).toEqual([
      "UnrestrictedAgents can reach any host.",
      "Limited",
    ])
  })

  test("checks the radio matching the value", async () => {
    const container = await mount(
      <RadioGroup.Root label="Network access" value="limited">
        {items}
      </RadioGroup.Root>,
    )
    expect(radios(container).map((radio) => radio.getAttribute("aria-checked"))).toEqual(["false", "true"])
  })

  test("reports the chosen value when an item is clicked", async () => {
    const changes: string[] = []
    const container = await mount(
      <RadioGroup.Root label="Network access" onValueChange={(value) => changes.push(value)}>
        {items}
      </RadioGroup.Root>,
    )
    await act(async () => radios(container)[1]?.closest("label")?.click())
    expect(changes).toEqual(["limited"])
    expect(radios(container)[1]?.getAttribute("aria-checked")).toBe("true")
  })

  test("takes its invalid state from a Base UI field", async () => {
    const container = await mount(
      <Field.Root invalid>
        <RadioGroup.Root label="Network access">{items}</RadioGroup.Root>
      </Field.Root>,
    )
    expect(radios(container).every((radio) => radio.hasAttribute("data-invalid"))).toBe(true)
  })

  test("names each radio by its own label inside a field", async () => {
    const container = await mount(
      <Field.Root>
        <Field.Label>Network access</Field.Label>
        <RadioGroup.Root>{items}</RadioGroup.Root>
      </Field.Root>,
    )
    expect(
      radios(container).map(
        (radio) => container.querySelector(`#${CSS.escape(radio.getAttribute("aria-labelledby") ?? "")}`)?.textContent,
      ),
    ).toEqual(["Unrestricted", "Limited"])
  })
})

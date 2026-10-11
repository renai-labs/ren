import type { StandardSchemaV1 } from "@tanstack/react-form"
import { afterEach, describe, expect, test } from "bun:test"
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot } from "react-dom/client"
import type { Root } from "react-dom/client"
import { Form } from "../src/components/form.js"
import { RadioGroup } from "../src/components/radio-group.js"

const codeSchema: StandardSchemaV1<{ code: string }, { code: number }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) =>
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      /^\d{4}$/.test(value.code)
        ? { value: { code: Number(value.code) } }
        : { issues: [{ message: "Enter the 4-digit code", path: ["code"] }] },
  },
}

function CodeForm(props: { code: string; onSubmit: (value: { code: number }) => void | Promise<void> }) {
  const form = Form.useForm({ defaultValues: { code: props.code }, schema: codeSchema, onSubmit: props.onSubmit })
  return (
    <Form.Root form={form} label="Verify">
      <form.AppField name="code">{(field) => <field.CodeField label="Verification code" length={4} />}</form.AppField>
      <form.SubmitButton pendingLabel="Verifying…">Verify</form.SubmitButton>
    </Form.Root>
  )
}

type Signup = { name: string; plan: string; terms: boolean }
type Account = { name: string; plan: "free" | "team"; terms: true }

const fields = (input: unknown): { name: string; plan: Account["plan"] | undefined; terms: boolean } => {
  const value = typeof input === "object" && input !== null ? input : {}
  return {
    name: "name" in value && typeof value.name === "string" ? value.name.trim() : "",
    plan: "plan" in value && (value.plan === "free" || value.plan === "team") ? value.plan : undefined,
    terms: "terms" in value && value.terms === true,
  }
}

const signupSchema: StandardSchemaV1<Signup, Account> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (input) => {
      const value = fields(input)
      if (value.name !== "" && value.plan !== undefined && value.terms)
        return { value: { name: value.name, plan: value.plan, terms: value.terms } }
      return {
        issues: [
          ...(value.name === "" ? [{ message: "Enter your name", path: ["name"] }] : []),
          ...(value.plan === undefined ? [{ message: "Choose a plan", path: ["plan"] }] : []),
          ...(value.terms ? [] : [{ message: "Accept the terms", path: ["terms"] }]),
        ],
      }
    },
  },
}

const plans = [
  { value: "free", label: "Free" },
  { value: "team", label: "Team" },
]

function SignupForm(props: { values: Signup; onSubmit: (value: Account) => void }) {
  const form = Form.useForm({ defaultValues: props.values, schema: signupSchema, onSubmit: props.onSubmit })
  return (
    <Form.Root form={form} label="Sign up">
      <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
      <form.AppField name="plan">
        {(field) => <field.Select label="Plan" placeholder="Choose a plan" options={plans} />}
      </form.AppField>
      <form.AppField name="terms">{(field) => <field.Checkbox label="Accept the terms of service" />}</form.AppField>
      <form.SubmitButton pendingLabel="Signing up…">Sign up</form.SubmitButton>
    </Form.Root>
  )
}

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

const submit = (container: HTMLElement) =>
  act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const errors = (container: HTMLElement) =>
  [...container.querySelectorAll('[aria-live="polite"]')].map((error) => error.textContent)

const labelled = (container: HTMLElement, selector: string) => {
  const control = container.querySelector(selector)
  return container.querySelector(`[id="${control?.getAttribute("aria-labelledby")}"]`)?.textContent
}

describe("Form with CodeField", () => {
  test("renders a labelled form whose fields are labelled", async () => {
    const container = await mount(<CodeForm code="" onSubmit={() => undefined} />)
    const form = container.querySelector("form")
    expect(form?.getAttribute("aria-label")).toBe("Verify")
    expect(form?.noValidate).toBe(true)
    const label = container.querySelector("label")
    expect(label?.textContent).toBe("Verification code")
    expect(label?.htmlFor).toBe(container.querySelector('[data-slot="code-field"] input')?.id ?? "missing")
  })

  test("shows the field error and skips onSubmit when the input is invalid", async () => {
    const submitted: Array<{ code: number }> = []
    const container = await mount(<CodeForm code="12" onSubmit={(value) => void submitted.push(value)} />)
    expect(container.textContent).not.toContain("Enter the 4-digit code")
    await submit(container)
    expect(submitted).toEqual([])
    expect(errors(container)).toEqual(["Enter the 4-digit code"])
    expect(container.querySelector('[data-slot="code-field"] input')?.getAttribute("aria-invalid")).toBe("true")
  })

  test("calls onSubmit with the decoded values when the input is valid", async () => {
    const submitted: Array<{ code: number }> = []
    const container = await mount(<CodeForm code="1234" onSubmit={(value) => void submitted.push(value)} />)
    await submit(container)
    expect(submitted).toEqual([{ code: 1234 }])
    expect(errors(container)).toEqual([])
  })

  test("shows the submit button as pending while onSubmit runs", async () => {
    const pending = Promise.withResolvers<void>()
    const container = await mount(<CodeForm code="1234" onSubmit={() => pending.promise} />)
    await submit(container)
    const button = container.querySelector("button")
    expect(button?.getAttribute("aria-busy")).toBe("true")
    expect(button?.textContent).toBe("Verifying…")
    await act(async () => pending.resolve())
    expect(button?.hasAttribute("aria-busy")).toBe(false)
    expect(button?.textContent).toBe("Verify")
  })
})

describe("Form with text field, select and checkbox", () => {
  test("labels each control once through its field", async () => {
    const container = await mount(
      <SignupForm values={{ name: "", plan: "", terms: false }} onSubmit={() => undefined} />,
    )
    expect(labelled(container, "input[name='name']")).toBe("Name")
    expect(labelled(container, '[role="combobox"]')).toBe("Plan")
    expect(labelled(container, '[role="checkbox"]')).toBe("Accept the terms of service")
    expect(container.textContent.split("Accept the terms of service")).toHaveLength(2)
  })

  test("shows every error and skips onSubmit when the values are invalid", async () => {
    const submitted: Account[] = []
    const container = await mount(
      <SignupForm values={{ name: " ", plan: "", terms: false }} onSubmit={(value) => void submitted.push(value)} />,
    )
    await submit(container)
    expect(submitted).toEqual([])
    expect(errors(container)).toEqual(["Enter your name", "Choose a plan", "Accept the terms"])
    expect(
      ["input[name='name']", '[role="combobox"]', '[role="checkbox"]'].map((selector) =>
        container.querySelector(selector)?.getAttribute("aria-invalid"),
      ),
    ).toEqual(["true", "true", "true"])
  })

  test("calls onSubmit with the decoded values when the values are valid", async () => {
    const submitted: Account[] = []
    const container = await mount(
      <SignupForm
        values={{ name: "  Ada ", plan: "team", terms: true }}
        onSubmit={(value) => void submitted.push(value)}
      />,
    )
    await submit(container)
    expect(submitted).toEqual([{ name: "Ada", plan: "team", terms: true }])
    expect(errors(container)).toEqual([])
  })

  test("updates the form state as the controls change and clears fixed errors", async () => {
    const submitted: Account[] = []
    const container = await mount(
      <SignupForm values={{ name: "", plan: "", terms: false }} onSubmit={(value) => void submitted.push(value)} />,
    )
    await submit(container)
    const input = container.querySelector<HTMLInputElement>("input[name='name']")
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Grace")
      input?.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => container.querySelector<HTMLElement>('[role="checkbox"]')?.click())
    expect(errors(container)).toEqual(["Choose a plan"])
    expect(input?.value).toBe("Grace")
    expect(container.querySelector('[role="checkbox"]')?.getAttribute("aria-checked")).toBe("true")
    await act(async () => container.querySelector<HTMLElement>('[role="combobox"]')?.click())
    const team = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')].at(-1)
    await act(async () => team?.click())
    expect(errors(container)).toEqual([])
    await submit(container)
    expect(submitted).toEqual([{ name: "Grace", plan: "team", terms: true }])
  })
})

describe("Form with choice controls", () => {
  type Preferences = { theme: string; notify: boolean; role: string }
  const preferencesSchema: StandardSchemaV1<Preferences> = {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => ({ issues: [{ message: "Pick a role", path: ["role"] }] }),
    },
  }

  function PreferencesForm() {
    const form = Form.useForm({
      defaultValues: { theme: "light", notify: false, role: "" },
      schema: preferencesSchema,
      onSubmit: () => undefined,
    })
    return (
      <Form.Root form={form} label="Preferences">
        <form.AppField name="theme">
          {(field) => (
            <field.SegmentedControl
              label="Theme"
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
            />
          )}
        </form.AppField>
        <form.AppField name="notify">{(field) => <field.Switch label="Email me updates" />}</form.AppField>
        <form.AppField name="role">
          {(field) => (
            <field.RadioGroup label="Role">
              <RadioGroup.Item value="admin" label="Admin" />
              <RadioGroup.Item value="member" label="Member" />
            </field.RadioGroup>
          )}
        </form.AppField>
        <form.SubmitButton pendingLabel="Saving…">Save</form.SubmitButton>
      </Form.Root>
    )
  }

  test("names the segmented control, switch and radio group once", async () => {
    const container = await mount(<PreferencesForm />)
    expect(container.querySelector('[data-slot="segmented-control"]')?.getAttribute("aria-label")).toBe("Theme")
    expect(labelled(container, '[role="switch"]')).toBe("Email me updates")
    expect(labelled(container, '[role="radiogroup"]')).toBe("Role")
    expect(container.textContent.split("Role")).toHaveLength(2)
  })

  test("binds values and shows the radio group error", async () => {
    const container = await mount(<PreferencesForm />)
    await act(async () => [...container.querySelectorAll<HTMLElement>('[aria-pressed="false"]')].at(0)?.click())
    await act(async () => container.querySelector<HTMLElement>('[role="switch"]')?.click())
    await submit(container)
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Dark")
    expect(container.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true")
    expect(errors(container)).toEqual(["Pick a role"])
    expect(container.querySelector('[role="radiogroup"]')?.getAttribute("aria-invalid")).toBe("true")
  })
})

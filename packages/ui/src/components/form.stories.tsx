import type { StandardSchemaV1 } from "@tanstack/react-form"
import type { Meta, StoryObj } from "@storybook/react-vite"
import { Form } from "./form.js"
import { RadioGroup } from "./radio-group.js"

const codeSchema: StandardSchemaV1<{ code: string }> = {
  "~standard": {
    version: 1,
    vendor: "story",
    validate: (value) =>
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      value.code.length === 6
        ? { value: { code: value.code } }
        : { issues: [{ message: "Enter the 6-digit code from your email.", path: ["code"] }] },
  },
}

function VerifyForm() {
  const form = Form.useForm({
    defaultValues: { code: "" },
    schema: codeSchema,
    onSubmit: () => new Promise((resolve) => setTimeout(resolve, 1500)),
  })
  return (
    <Form.Root form={form} label="Verify your email">
      <form.AppField name="code">{(field) => <field.CodeField label="Verification code" />}</form.AppField>
      <form.SubmitButton pendingLabel="Verifying…">Verify</form.SubmitButton>
    </Form.Root>
  )
}

type Environment = {
  name: string
  description: string
  region: string
  access: string
  visibility: string
  buildNow: boolean
  notify: boolean
}

const fields = (input: unknown) => {
  const value = typeof input === "object" && input !== null ? input : {}
  return {
    name: "name" in value && typeof value.name === "string" ? value.name.trim() : "",
    region: "region" in value && typeof value.region === "string" ? value.region : "",
    access: "access" in value && typeof value.access === "string" ? value.access : "",
  }
}

const environmentSchema: StandardSchemaV1<Environment, { name: string; region: string; access: string }> = {
  "~standard": {
    version: 1,
    vendor: "story",
    validate: (input) => {
      const value = fields(input)
      const issues = [
        ...(value.name === "" ? [{ message: "Name the environment.", path: ["name"] }] : []),
        ...(value.region === "" ? [{ message: "Choose a region.", path: ["region"] }] : []),
        ...(value.access === "" ? [{ message: "Choose how agents reach the network.", path: ["access"] }] : []),
      ]
      return issues.length > 0 ? { issues } : { value }
    },
  },
}

function EnvironmentForm() {
  const form = Form.useForm({
    defaultValues: {
      name: "",
      description: "",
      region: "",
      access: "",
      visibility: "team",
      buildNow: true,
      notify: false,
    },
    schema: environmentSchema,
    onSubmit: () => new Promise((resolve) => setTimeout(resolve, 1500)),
  })
  return (
    <Form.Root form={form} label="Create environment" arrangement="loose-stack">
      <form.AppField name="name">{(field) => <field.TextField label="Name" placeholder="Staging" />}</form.AppField>
      <form.AppField name="description">
        {(field) => <field.TextArea label="Description" necessity="optional" height="automatic" />}
      </form.AppField>
      <form.AppField name="region">
        {(field) => (
          <field.Select
            label="Region"
            placeholder="Choose a region"
            width="full"
            options={[
              { value: "us-east", label: "US East" },
              { value: "eu-west", label: "EU West" },
              { value: "ap-south", label: "Asia Pacific" },
            ]}
          />
        )}
      </form.AppField>
      <form.AppField name="access">
        {(field) => (
          <field.RadioGroup label="Network access">
            <RadioGroup.Item value="unrestricted" label="Unrestricted" description="Agents can reach any host." />
            <RadioGroup.Item value="limited" label="Limited" description="Only approved destinations." />
          </field.RadioGroup>
        )}
      </form.AppField>
      <form.AppField name="visibility">
        {(field) => (
          <field.SegmentedControl
            label="Visibility"
            width="full"
            options={[
              { value: "private", label: "Private" },
              { value: "team", label: "Team" },
              { value: "public", label: "Public" },
            ]}
          />
        )}
      </form.AppField>
      <form.AppField name="buildNow">{(field) => <field.Switch label="Build after creation" />}</form.AppField>
      <form.AppField name="notify">
        {(field) => <field.Checkbox label="Email me when the build finishes" />}
      </form.AppField>
      <form.SubmitButton pendingLabel="Creating…">Create environment</form.SubmitButton>
    </Form.Root>
  )
}

const meta = {
  title: "UI/Form",
  component: Form.Root,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Form.Root>

export default meta

type Story = StoryObj<typeof Form.Root>

export const Default: Story = { render: () => <VerifyForm /> }

export const CreateEnvironment: Story = { render: () => <EnvironmentForm /> }

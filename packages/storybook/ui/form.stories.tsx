import type { Meta, StoryObj } from "@storybook/react-vite"
import { Form } from "@ren/ui/form"
import { RadioGroup } from "@ren/ui/radio-group"
import { Schema } from "effect"

const codeSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    code: Schema.String.check(Schema.isPattern(/^\d{6}$/, { message: "Enter the 6-digit code from your email." })),
  }),
)

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

const environmentSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    name: Schema.String.check(Schema.isNonEmpty({ message: "Name the environment." })),
    description: Schema.String,
    region: Schema.String.check(Schema.isNonEmpty({ message: "Choose a region." })),
    access: Schema.String.check(Schema.isNonEmpty({ message: "Choose how agents reach the network." })),
    visibility: Schema.String,
    buildNow: Schema.Boolean,
    notify: Schema.Boolean,
  }),
)

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

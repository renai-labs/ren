import { Input } from "@base-ui/react/input"
import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ComponentProps } from "react"
import { Checkbox } from "@ren/ui/checkbox"
import { CodeField } from "@ren/ui/code-field"
import { Field } from "@ren/ui/field"
import { Link } from "@ren/ui/link"
import { PasswordField } from "@ren/ui/password-field"
import { RadioGroup } from "@ren/ui/radio-group"
import { SearchField } from "@ren/ui/search-field"
import { SegmentedControl } from "@ren/ui/segmented-control"
import { Select } from "@ren/ui/select"
import { Switch } from "@ren/ui/switch"
import { TextArea } from "@ren/ui/text-area"
import { TextField } from "@ren/ui/text-field"

function StoryInput(props: Omit<ComponentProps<typeof Input>, "className">) {
  return (
    <span className="flex h-8 w-full min-w-0 items-center gap-2 rounded-control bg-background-secondary px-3 text-sm inset-ring-1 inset-ring-border-primary transition-standard has-aria-invalid:inset-ring-status-danger has-[input:disabled]:opacity-disabled">
      <Input {...props} className="size-full min-w-0 flex-1 bg-transparent placeholder-muted text-text-primary" />
    </span>
  )
}

const meta = {
  component: Field.Root,
  args: { label: "Email", children: <StoryInput placeholder="name@example.com" /> },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Description: Story = { args: { description: "We send sign-in codes to this address." } }
export const Optional: Story = { args: { label: "Display name", necessity: "optional" } }
export const Hint: Story = { args: { hint: "Used for sign-in and notifications" } }
export const LabelAction: Story = {
  args: {
    label: "Password",
    labelAction: (
      <Link appearance="quiet" href="#forgot">
        Forgot password?
      </Link>
    ),
  },
}
export const Invalid: Story = { args: { error: "Enter a valid email address." } }
export const InvalidWithDescription: Story = {
  args: { description: "We send sign-in codes to this address.", error: "Enter a valid email address." },
}
export const Horizontal: Story = {
  args: { orientation: "horizontal", description: "Shown on your profile.", label: "Display name" },
}
export const Row: Story = { args: { orientation: "row", description: "Shown on your profile.", label: "Display name" } }
export const RowInvalid: Story = { args: { orientation: "row", label: "Display name", error: "Name is required." } }
export const Disabled: Story = { args: { disabled: true } }
export const WithTextField: Story = {
  args: {
    label: "Project name",
    description: "Shown on the dashboard.",
    error: "Name the project.",
    children: <TextField placeholder="Quarterly planning" />,
  },
}
export const WithPasswordField: Story = {
  args: {
    label: "Password",
    description: "At least 12 characters.",
    error: "Use at least 12 characters.",
    children: <PasswordField defaultValue="hunter2" />,
  },
}
export const WithTextArea: Story = {
  args: {
    label: "Description",
    description: "Shown on the project page.",
    error: "Keep it under 280 characters.",
    children: <TextArea rows={3} />,
  },
}
export const WithSearchField: Story = {
  args: {
    label: "Search projects",
    description: "Matches names and descriptions.",
    error: "Enter at least 3 characters.",
    children: <SearchField.Root value="bi" onValueChange={() => undefined} />,
  },
}
export const WithSelect: Story = {
  args: {
    label: "Region",
    description: "Where the environment runs.",
    error: "Choose a region.",
    children: (
      <Select.Root
        placeholder="Choose a region"
        width="full"
        options={[
          { value: "us-east", label: "US East" },
          { value: "eu-west", label: "EU West" },
        ]}
      />
    ),
  },
}
export const WithCheckbox: Story = {
  args: {
    label: "Accept the terms of service",
    description: "You can read them at any time.",
    error: "Accept the terms to continue.",
    orientation: "row",
    children: <Checkbox />,
  },
}
export const WithSwitch: Story = {
  args: {
    label: "Build after creation",
    description: "Starts the first build right away.",
    error: "Builds are paused for this workspace.",
    orientation: "row",
    children: <Switch />,
  },
}
export const WithRadioGroup: Story = {
  args: {
    label: "Network access",
    description: "Applies to every agent run.",
    error: "Choose how agents reach the network.",
    children: (
      <RadioGroup.Root>
        <RadioGroup.Item value="unrestricted" label="Unrestricted" description="Agents can reach any host." />
        <RadioGroup.Item value="limited" label="Limited" description="Only approved destinations." />
      </RadioGroup.Root>
    ),
  },
}
export const WithSegmentedControl: Story = {
  args: {
    label: "Visibility",
    description: "Who can open the environment.",
    error: "Public environments are disabled.",
    children: (
      <SegmentedControl
        label="Visibility"
        value="public"
        onValueChange={() => undefined}
        width="full"
        options={[
          { value: "private", label: "Private" },
          { value: "team", label: "Team" },
          { value: "public", label: "Public" },
        ]}
      />
    ),
  },
}
export const WithCodeField: Story = {
  args: {
    label: "Verification code",
    description: "Sent to your email.",
    error: "That code has expired.",
    children: <CodeField length={4} defaultValue="1234" />,
  },
}

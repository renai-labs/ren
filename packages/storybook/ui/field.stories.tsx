import { Input } from "@base-ui/react/input"
import type { Meta, StoryObj } from "@storybook/react-vite"
import type { ComponentProps } from "react"
import { Field } from "@ren/ui/field"
import { Link } from "@ren/ui/link"

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

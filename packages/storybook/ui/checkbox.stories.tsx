import type { Meta, StoryObj } from "@storybook/react-vite"
import { Checkbox } from "@ren/ui/checkbox"

const meta = {
  component: Checkbox,
  args: { label: "Use PKCE" },
} satisfies Meta<typeof Checkbox>

export default meta

type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}
export const Checked: Story = { args: { checked: true } }
export const Indeterminate: Story = { args: { indeterminate: true } }
export const Disabled: Story = { args: { disabled: true } }
export const DisabledChecked: Story = { args: { checked: true, disabled: true } }
export const Small: Story = { args: { size: "small", checked: true } }
export const VisibleLabel: Story = { args: { labelVisibility: "visible" } }
export const Description: Story = {
  args: { labelVisibility: "visible", description: "Require a code challenge on every authorization request." },
}
export const DisabledDescription: Story = {
  args: {
    labelVisibility: "visible",
    description: "Require a code challenge on every authorization request.",
    checked: true,
    disabled: true,
  },
}

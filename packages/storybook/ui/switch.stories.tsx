import type { Meta, StoryObj } from "@storybook/react-vite"
import { Switch } from "@ren/ui/switch"

const meta = {
  component: Switch,
  args: { label: "Build after creation" },
} satisfies Meta<typeof Switch>

export default meta

type Story = StoryObj<typeof meta>

export const Unchecked: Story = {}
export const Checked: Story = { args: { checked: true } }
export const Disabled: Story = { args: { disabled: true } }
export const DisabledChecked: Story = { args: { checked: true, disabled: true } }
export const Small: Story = { args: { size: "small" } }
export const SmallChecked: Story = { args: { size: "small", checked: true } }

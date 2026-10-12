import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"

const meta = {
  component: Icon,
  args: { glyph: "Settings" },
} satisfies Meta<typeof Icon>

export default meta

type Story = StoryObj<typeof meta>

export const Small: Story = {}
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Medium: Story = { args: { size: "medium" } }
export const Large: Story = { args: { size: "large" } }
export const ExtraLarge: Story = { args: { size: "extra-large" } }
export const Primary: Story = { args: { tone: "primary" } }
export const Secondary: Story = { args: { tone: "secondary" } }
export const Accent: Story = { args: { tone: "accent" } }
export const Success: Story = { args: { tone: "success" } }
export const Warning: Story = { args: { tone: "warning" } }
export const Danger: Story = { args: { tone: "danger" } }
export const Labelled: Story = { args: { size: "medium", label: "Settings" } }

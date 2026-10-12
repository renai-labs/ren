import type { Meta, StoryObj } from "@storybook/react-vite"
import { StatusDot } from "@ren/ui/status-dot"

const meta = {
  component: StatusDot,
} satisfies Meta<typeof StatusDot>

export default meta

type Story = StoryObj<typeof meta>

export const Neutral: Story = {}
export const Muted: Story = { args: { tone: "muted" } }
export const Accent: Story = { args: { tone: "accent" } }
export const Success: Story = { args: { tone: "success" } }
export const Warning: Story = { args: { tone: "warning" } }
export const Danger: Story = { args: { tone: "danger" } }
export const Labelled: Story = { args: { tone: "warning", label: "Keys missing" } }
export const Pulse: Story = { args: { tone: "accent", activity: "pulse" } }

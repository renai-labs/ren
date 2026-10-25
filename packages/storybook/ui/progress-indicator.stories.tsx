import type { Meta, StoryObj } from "@storybook/react-vite"
import { ProgressIndicator } from "@ren/ui/progress-indicator"

const meta = {
  component: ProgressIndicator,
} satisfies Meta<typeof ProgressIndicator>

export default meta

type Story = StoryObj<typeof meta>

export const Small: Story = {}
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Medium: Story = { args: { size: "medium" } }
export const Large: Story = { args: { size: "large" } }
export const Inherit: Story = { args: { tone: "inherit" } }
export const Bar: Story = { args: { presentation: "bar", value: 42, tone: "accent", label: "5-hour usage" } }
export const BarFull: Story = { args: { presentation: "bar", value: 100, tone: "danger", label: "Weekly usage" } }

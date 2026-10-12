import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"

const meta = {
  component: Button,
  args: { children: "Save draft" },
} satisfies Meta<typeof Button>

export default meta

type Story = StoryObj<typeof meta>

export const Secondary: Story = {}
export const Primary: Story = { args: { appearance: "primary" } }
export const Outline: Story = { args: { appearance: "outline" } }
export const Ghost: Story = { args: { appearance: "ghost" } }
export const Plain: Story = { args: { appearance: "plain" } }
export const Danger: Story = { args: { appearance: "danger", children: "Delete project" } }
export const Link: Story = { args: { appearance: "link", children: "View details" } }
export const Text: Story = { args: { appearance: "text", children: "Quarterly planning notes" } }
export const Small: Story = { args: { size: "small" } }
export const Compact: Story = { args: { size: "compact" } }
export const Large: Story = { args: { size: "large" } }
export const Full: Story = { args: { width: "full" } }
export const Pill: Story = { args: { shape: "pill" } }
export const LeadingIcon: Story = { args: { leadingIcon: <Icon glyph="Plus" />, children: "Add member" } }
export const TrailingIcon: Story = { args: { trailingIcon: <Icon glyph="ChevronDown" />, children: "Sort by" } }
export const Pending: Story = { args: { pending: true } }
export const PendingLabel: Story = { args: { pending: true, pendingLabel: "Saving…" } }
export const Disabled: Story = { args: { disabled: true } }

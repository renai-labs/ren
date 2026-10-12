import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "@ren/ui/badge"
import { Icon } from "@ren/ui/icon"

const meta = {
  component: Badge,
  args: { children: "Draft" },
} satisfies Meta<typeof Badge>

export default meta

type Story = StoryObj<typeof meta>

export const Neutral: Story = {}
export const Muted: Story = { args: { tone: "muted" } }
export const Accent: Story = { args: { tone: "accent" } }
export const Success: Story = { args: { tone: "success" } }
export const Warning: Story = { args: { tone: "warning" } }
export const Danger: Story = { args: { tone: "danger" } }
export const Outline: Story = { args: { appearance: "outline" } }
export const OutlineMuted: Story = { args: { appearance: "outline", tone: "muted" } }
export const OutlineAccent: Story = { args: { appearance: "outline", tone: "accent" } }
export const OutlineSuccess: Story = { args: { appearance: "outline", tone: "success" } }
export const OutlineWarning: Story = { args: { appearance: "outline", tone: "warning" } }
export const OutlineDanger: Story = { args: { appearance: "outline", tone: "danger" } }
export const Tag: Story = { args: { appearance: "tag" } }
export const TagMuted: Story = { args: { appearance: "tag", tone: "muted" } }
export const Medium: Story = { args: { size: "medium" } }
export const Large: Story = { args: { size: "large" } }
export const Control: Story = { args: { size: "control", appearance: "tag", icon: <Icon glyph="Link" /> } }
export const Pill: Story = { args: { shape: "pill" } }
export const Mono: Story = { args: { typeface: "mono", children: "api.ren.ai" } }
export const Marker: Story = { args: { marker: "dot", tone: "success", children: "Running" } }
export const MarkerTone: Story = { args: { marker: "dot", markerTone: "danger", appearance: "tag", children: "Bug" } }
export const LeadingIcon: Story = {
  args: { tone: "success", shape: "pill", size: "medium", icon: <Icon glyph="Check" />, children: "Connected" },
}
export const Removable: Story = {
  args: {
    appearance: "outline",
    shape: "pill",
    size: "medium",
    onRemove: () => undefined,
    removeLabel: "Remove status filter",
    children: "Status",
  },
}

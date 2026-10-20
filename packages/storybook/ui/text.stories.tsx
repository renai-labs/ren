import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"
import { Text } from "@ren/ui/text"

const paragraph =
  "Ren keeps every conversation, task and file for a project in one place, so the whole team can pick up where anyone left off without asking for a recap or digging through old threads."

const meta = {
  component: Text,
  args: { children: "Quarterly planning notes" },
} satisfies Meta<typeof Text>

export default meta

type Story = StoryObj<typeof meta>

export const Body: Story = {}
export const Display: Story = { args: { purpose: "display" } }
export const Title: Story = { args: { purpose: "title" } }
export const Heading: Story = { args: { purpose: "heading" } }
export const Label: Story = { args: { purpose: "label" } }
export const Caption: Story = { args: { purpose: "caption" } }
export const Code: Story = { args: { purpose: "code", children: "ren init --team design" } }
export const Secondary: Story = { args: { tone: "secondary" } }
export const Accent: Story = { args: { tone: "accent" } }
export const Success: Story = { args: { tone: "success" } }
export const Warning: Story = { args: { tone: "warning" } }
export const Danger: Story = { args: { tone: "danger" } }
export const Regular: Story = { args: { purpose: "label", weight: "regular" } }
export const Medium: Story = { args: { weight: "medium" } }
export const SingleLine: Story = { args: { truncation: "single-line", children: paragraph } }
export const TwoLines: Story = { args: { truncation: "two-lines", children: `${paragraph} ${paragraph}` } }
export const ThreeLines: Story = {
  args: { truncation: "three-lines", children: `${paragraph} ${paragraph} ${paragraph}` },
}
export const Anywhere: Story = {
  args: { wrapping: "anywhere", children: "https://ren.example/projects/0f8c2a7d9e4b1c3a5f6e8d7c9b0a1e2f" },
}
export const Preserved: Story = {
  args: { wrapping: "preserved", children: "Draft the report.\n\n  - Revenue\n  - Churn" },
}
export const NoWrap: Story = { args: { wrapping: "none", children: paragraph } }
export const Balanced: Story = { args: { wrapping: "balanced", children: paragraph } }
export const Center: Story = { args: { alignment: "center" } }
export const End: Story = { args: { alignment: "end" } }
export const Tabular: Story = { args: { numerals: "tabular", children: "1,204.50 · 98.10 · 11.11" } }
export const Active: Story = { args: { activity: "active", children: "Thinking…" } }
export const Shimmer: Story = { args: { activity: "shimmer", children: "Searching the workspace" } }
export const Uppercase: Story = { args: { purpose: "caption", letterCase: "uppercase" } }
export const Capitalized: Story = { args: { letterCase: "capitalized", children: "quarterly planning notes" } }
export const LeadingIcon: Story = {
  args: { tone: "secondary", leadingIcon: <Icon glyph="Lock" tone="secondary" />, children: "Only you can see this" },
}

import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "./icon.js"
import { IconButton } from "./icon-button.js"

const meta = {
  title: "UI/Icon Button",
  component: IconButton,
  args: { label: "Open settings", children: <Icon glyph="Settings" /> },
} satisfies Meta<typeof IconButton>

export default meta

type Story = StoryObj<typeof meta>

export const Plain: Story = {}
export const Secondary: Story = { args: { appearance: "secondary" } }
export const Outline: Story = { args: { appearance: "outline" } }
export const Primary: Story = { args: { appearance: "primary" } }
export const Overlay: Story = { args: { appearance: "overlay" } }
export const ExtraSmall: Story = { args: { size: "extra-small" } }
export const Compact: Story = { args: { size: "compact" } }
export const Medium: Story = { args: { size: "medium" } }
export const Large: Story = { args: { size: "large" } }
export const Circle: Story = { args: { shape: "circle" } }
export const Pressed: Story = { args: { "aria-pressed": true } }
export const Attention: Story = {
  args: { indicator: "attention", label: "Filter tasks", children: <Icon glyph="ListFilter" /> },
}
export const AttentionSecondary: Story = { args: { indicator: "attention", appearance: "secondary", size: "medium" } }
export const Pending: Story = { args: { pending: true } }
export const Disabled: Story = { args: { disabled: true } }

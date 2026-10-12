import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"
import { TextField } from "@ren/ui/text-field"

const meta = {
  component: TextField,
  args: { placeholder: "Quarterly planning", "aria-label": "Project name" },
} satisfies Meta<typeof TextField>

export default meta

type Story = StoryObj<typeof meta>

export const Outline: Story = {}
export const Filled: Story = { args: { appearance: "filled" } }
export const Small: Story = { args: { size: "small" } }
export const Compact: Story = { args: { size: "compact" } }
export const Large: Story = { args: { size: "large" } }
export const Mono: Story = { args: { typeface: "mono", defaultValue: "ren-api-production" } }
export const WidthCompact: Story = { args: { width: "compact" } }
export const WidthFill: Story = { args: { width: "fill" } }
export const Leading: Story = { args: { leading: <Icon glyph="Search" /> } }
export const Trailing: Story = { args: { trailing: <Icon glyph="Link" /> } }
export const WithValue: Story = { args: { defaultValue: "Quarterly planning" } }
export const Invalid: Story = { args: { invalid: true, defaultValue: "Quarterly planning" } }
export const Disabled: Story = { args: { disabled: true, defaultValue: "Quarterly planning" } }
export const Suggestions: Story = {
  args: { suggestions: ["bash", "edit", "read", "webfetch"], placeholder: "Permission", "aria-label": "Permission" },
}

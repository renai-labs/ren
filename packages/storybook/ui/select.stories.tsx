import type { Meta, StoryObj } from "@storybook/react-vite"
import { Icon } from "@ren/ui/icon"
import { Select } from "@ren/ui/select"

const meta = {
  component: Select.Root,
  args: {
    label: "Model",
    placeholder: "Choose a model",
    options: [
      { value: "sonnet", label: "Claude Sonnet" },
      { value: "opus", label: "Claude Opus" },
      { value: "haiku", label: "Claude Haiku" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="flex h-64 items-start justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Select.Root<string>>

export default meta

type Story = StoryObj<typeof meta>

export const Placeholder: Story = {}
export const Selected: Story = { args: { value: "opus" } }
export const Open: Story = { args: { value: "opus", defaultOpen: true } }
export const Filled: Story = { args: { value: "opus", appearance: "filled" } }
export const Plain: Story = { args: { value: "opus", appearance: "plain" } }
export const Inline: Story = { args: { value: "opus", appearance: "inline" } }
export const Property: Story = { args: { value: "opus", appearance: "property", shape: "pill", size: "small" } }
export const Chip: Story = { args: { value: "opus", appearance: "chip", shape: "pill", size: "small" } }
export const Small: Story = { args: { value: "opus", size: "small" } }
export const Compact: Story = { args: { value: "opus", size: "compact" } }
export const Large: Story = { args: { value: "opus", size: "large" } }
export const Pill: Story = { args: { value: "opus", shape: "pill" } }
export const Fit: Story = { args: { value: "opus", shape: "fit", appearance: "plain" } }
export const ChevronUp: Story = { args: { value: "opus", indicator: "chevron-up" } }
export const NoIndicator: Story = { args: { value: "opus", indicator: "none" } }
export const CompactWidth: Story = { args: { value: "opus", width: "compact" } }
export const LimitedWidth: Story = { args: { value: "opus", width: "limited" } }
export const Full: Story = { args: { value: "opus", width: "full" } }
export const Leading: Story = { args: { value: "opus", leading: <Icon glyph="Clock" /> } }
export const OptionIcons: Story = {
  args: {
    value: "spend",
    defaultOpen: true,
    label: "Measure",
    options: [
      { value: "spend", label: "Spend", icon: <Icon glyph="Wallet" /> },
      { value: "events", label: "LLM calls", icon: <Icon glyph="Zap" /> },
    ],
  },
}
export const Disabled: Story = { args: { value: "opus", disabled: true } }
export const Button: Story = {
  render: () => (
    <Select.Button label="Due date" leading={<Icon glyph="Calendar" />}>
      Tomorrow
    </Select.Button>
  ),
}
export const ButtonPlaceholder: Story = {
  render: () => <Select.Button label="Due date" placeholder="Pick a date" leading={<Icon glyph="Calendar" />} />,
}
export const ButtonChip: Story = {
  render: () => (
    <Select.Button label="Labels" appearance="chip" shape="pill" size="small" indicator="none">
      2 labels
    </Select.Button>
  ),
}
export const ButtonSquare: Story = {
  render: () => (
    <Select.Button label="Add label" appearance="plain" shape="square" size="small" indicator="none">
      <Icon glyph="Plus" />
    </Select.Button>
  ),
}
export const ButtonCircle: Story = {
  render: () => (
    <Select.Button label="Assignee" appearance="plain" shape="circle" size="small" indicator="none">
      <Icon glyph="Plus" />
    </Select.Button>
  ),
}
export const ButtonInvalid: Story = {
  render: () => <Select.Button label="Due date" placeholder="Pick a date" invalid />,
}
export const ButtonDisabled: Story = {
  render: () => (
    <Select.Button label="Due date" disabled>
      Tomorrow
    </Select.Button>
  ),
}

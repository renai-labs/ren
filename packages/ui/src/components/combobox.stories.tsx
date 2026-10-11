import type { Meta, StoryObj } from "@storybook/react-vite"
import { Combobox } from "./combobox.js"
import { Icon } from "./icon.js"
import { Select } from "./select.js"
import { Text } from "./text.js"

const people = [
  {
    value: "ada",
    label: "Ada Lovelace",
    description: "ada@ren.dev",
    keywords: ["ada@ren.dev"],
    icon: <Icon glyph="User" />,
  },
  {
    value: "alan",
    label: "Alan Turing",
    description: "alan@ren.dev",
    keywords: ["alan@ren.dev"],
    icon: <Icon glyph="User" />,
  },
  {
    value: "grace",
    label: "Grace Hopper",
    description: "grace@ren.dev",
    keywords: ["grace@ren.dev"],
    icon: <Icon glyph="User" />,
  },
  {
    value: "invite",
    label: "linus@ren.dev",
    description: "Invitation pending",
    icon: <Icon glyph="Mail" />,
    disabled: true,
  },
]

const groups = [
  {
    value: "teams",
    label: "Teams",
    items: [
      { value: "design", label: "Design", detail: "12 members" },
      { value: "platform", label: "Platform", detail: "8 members" },
    ],
  },
  {
    value: "projects",
    label: "Projects",
    items: [
      { value: "launch", label: "Launch plan" },
      { value: "billing", label: "Billing revamp" },
    ],
  },
]

const meta = {
  title: "UI/Combobox",
  component: Combobox.Inline,
  args: { label: "User", searchPlaceholder: "Search by name or email…", emptyMessage: "No matches.", items: people },
  decorators: [
    (Story) => (
      <div className="flex h-96 flex-col items-center p-12 *:w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Combobox.Inline>

export default meta

type Story = StoryObj<typeof Combobox.Inline>

const trigger = <Select.Button label="Members to add" placeholder="Add members" width="full" />

export const Inline: Story = {}
export const Selected: Story = { args: { defaultValue: "alan" } }
export const Multiple: Story = { args: { selection: "multiple", defaultValue: ["ada", "grace"] } }
export const Groups: Story = { args: { label: "Search", items: undefined, groups } }
export const Command: Story = { args: { label: "Search", items: undefined, groups, purpose: "command" } }
export const Empty: Story = { args: { items: [] } }
export const Loading: Story = { args: { state: "loading" } }
export const Failed: Story = { args: { state: "failed", failureMessage: "Couldn’t load teams." } }
export const SearchIcon: Story = { args: { searchIcon: <Icon glyph="Users" tone="secondary" /> } }
export const Footer: Story = { args: { footer: <Text purpose="caption">Invite people from team settings.</Text> } }
export const Panel: Story = {
  args: { label: "Search", items: undefined, groups, searchSize: "large", purpose: "command" },
  render: (args) => <Combobox.Panel {...args} />,
}
export const PanelHeader: Story = {
  args: {
    label: "Search",
    items: undefined,
    groups,
    searchSize: "large",
    purpose: "command",
    header: <Text purpose="caption">Recent</Text>,
  },
  render: (args) => <Combobox.Panel {...args} />,
}
export const Popover: Story = {
  render: (args) => <Combobox.Popover {...args} trigger={trigger} />,
}
export const PopoverOpen: Story = {
  render: (args) => <Combobox.Popover {...args} trigger={trigger} defaultOpen />,
}
export const PopoverMultiple: Story = {
  args: { selection: "multiple", defaultValue: ["ada"] },
  render: (args) => <Combobox.Popover {...args} trigger={trigger} width="large" defaultOpen />,
}
export const PopoverTriggerWidth: Story = {
  render: (args) => <Combobox.Popover {...args} trigger={trigger} width="trigger" defaultOpen />,
}
export const PopoverSpacious: Story = {
  args: { defaultValue: "alan", header: "Assign to" },
  render: (args) => <Combobox.Popover {...args} trigger={trigger} density="spacious" defaultOpen />,
}

import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { Combobox } from "@ren/ui/combobox"
import type { Option } from "@ren/ui/combobox"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { colors, defaultFilters, filterProperties, initialLabels, scopes, swatch } from "../support/combobox-data.js"

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
export const PopoverKeepOpen: Story = {
  render: (args) => <Combobox.Popover {...args} trigger={trigger} defaultOpen closeOnSelect={false} />,
}
export const PopoverMultipleCloseOnSelect: Story = {
  args: { selection: "multiple", defaultValue: ["ada"] },
  render: (args) => <Combobox.Popover {...args} trigger={trigger} width="large" defaultOpen closeOnSelect />,
}
export const PopoverTriggerWidth: Story = {
  render: (args) => <Combobox.Popover {...args} trigger={trigger} width="trigger" defaultOpen />,
}
export const PopoverSpacious: Story = {
  args: { defaultValue: "alan", header: "Assign to" },
  render: (args) => <Combobox.Popover {...args} trigger={trigger} density="spacious" defaultOpen />,
}

const leaves = (options: readonly Option[]): Option[] =>
  options.flatMap((option) => (option.options ? leaves(option.options) : [option]))

export const ProjectPicker: Story = {
  render: function Render() {
    const [value, setValue] = useState<string | null>("project:platform:billing")
    const chosen = scopes.flatMap((group) => leaves(group.items)).find((option) => option.value === value)
    return (
      <Combobox.Popover
        label="Find a space or project"
        searchPlaceholder="Search spaces and projects…"
        groups={scopes}
        value={value}
        onValueChange={setValue}
        trigger={
          <Select.Button label="Project" placeholder="Choose project" width="full">
            {chosen?.label}
          </Select.Button>
        }
      />
    )
  },
}

export const LabelPicker: Story = {
  render: function Render() {
    const [labels, setLabels] = useState(initialLabels)
    const [value, setValue] = useState<string[]>(["bug"])
    const names = labels.filter((label) => value.includes(label.value)).map((label) => label.label)
    return (
      <Combobox.Popover
        selection="multiple"
        label="Labels"
        searchPlaceholder="Search or create labels…"
        items={labels.map((label) => swatch(label.value, label.label, label.color))}
        value={value}
        onValueChange={setValue}
        createLabel={(query) => `Create label “${query}”`}
        createStep={{ label: "Color", options: colors.map((color) => swatch(color.value, color.label, color.value)) }}
        onCreate={async (name, step) => {
          await new Promise((resolve) => setTimeout(resolve, 300))
          if (name.length > 20) throw new Error("Label names can be up to 20 characters.")
          const created = {
            value: name.toLowerCase().replaceAll(" ", "-"),
            label: name,
            color: colors.find((color) => color.value === step)?.value ?? "neutral",
          }
          setLabels((current) => [...current, created])
          return created.value
        }}
        trigger={
          <Select.Button label="Task labels" placeholder="Add labels" width="full">
            {names.join(", ")}
          </Select.Button>
        }
      />
    )
  },
}

const summary = (labels: readonly string[]) => (labels.length > 1 ? `${labels.length} selected` : (labels[0] ?? "Any"))

export const Filters: Story = {
  render: function Render() {
    const [value, setValue] = useState(defaultFilters)
    const modified = value.length !== defaultFilters.length || value.some((entry) => !defaultFilters.includes(entry))
    const properties = filterProperties.map((property) => ({
      value: property.value,
      label: property.label,
      icon: <Icon glyph={property.glyph} />,
      selection: property.selection,
      detail: summary(
        property.options
          .filter((option) => value.includes(`${property.value}:${option.value}`))
          .map((option) => option.label),
      ),
      options: property.options.map((option) => ({ value: `${property.value}:${option.value}`, label: option.label })),
    }))
    return (
      <div className="flex justify-end">
        <Combobox.Popover
          selection="multiple"
          label="Filters"
          searchPlaceholder="Search filters…"
          groups={[{ value: "properties", label: "Properties", items: properties }]}
          value={value}
          onValueChange={setValue}
          alignment="end"
          trigger={
            <IconButton
              label={modified ? "Filter tasks, filters on" : "Filter tasks"}
              indicator={modified ? "attention" : "none"}
            >
              <Icon glyph="ListFilter" />
            </IconButton>
          }
          footer={
            <Button
              appearance="ghost"
              size="small"
              width="full"
              alignment="start"
              leadingIcon={<Icon glyph="Restore" />}
              disabled={!modified}
              onClick={() => setValue(defaultFilters)}
            >
              Reset to default
            </Button>
          }
        />
      </div>
    )
  },
}

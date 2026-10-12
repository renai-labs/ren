import type { ComponentProps } from "react"
import { Icon } from "@ren/ui/icon"
import { Select } from "@ren/ui/select"
import { Text } from "@ren/ui/text"
import { OptionList } from "ren-v1/composites/option-list"
import meta from "../ui/combobox.stories.js"

export default { ...meta, component: OptionList }

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

const trigger = <Select.Button label="Members to add" placeholder="Add members" width="full" />

type Props = Partial<ComponentProps<typeof OptionList>>

const story = (args: Props, value: string | null = null) => ({
  render: () => (
    <OptionList
      presentation="inline"
      label="User"
      searchPlaceholder="Search by name or email…"
      emptyMessage="No matches."
      items={people}
      value={value}
      onValueChange={() => undefined}
      {...args}
    />
  ),
})

const popover = (args: Props, value: string | null = null) => ({
  render: () => (
    <OptionList
      label="User"
      searchPlaceholder="Search by name or email…"
      emptyMessage="No matches."
      items={people}
      trigger={trigger}
      value={value}
      onValueChange={() => undefined}
      {...args}
    />
  ),
})

export const Inline = story({})
export const Selected = story({}, "alan")
export const Multiple = {
  render: () => (
    <OptionList
      presentation="inline"
      selection="multiple"
      label="User"
      searchPlaceholder="Search by name or email…"
      emptyMessage="No matches."
      items={people}
      value={["ada", "grace"]}
      onValueChange={() => undefined}
    />
  ),
}
export const Groups = story({ label: "Search", items: undefined, groups })
export const Command = story({ label: "Search", items: undefined, groups, purpose: "command" })
export const Empty = story({ items: [] })
export const Loading = story({ state: "loading" })
export const Failed = story({ state: "failed", failureMessage: "Couldn’t load teams." })
export const SearchIcon = story({ searchIcon: <Icon glyph="Users" tone="secondary" /> })
export const Footer = story({ footer: <Text purpose="caption">Invite people from team settings.</Text> })
export const Panel = story({
  presentation: "panel",
  label: "Search",
  items: undefined,
  groups,
  searchSize: "large",
  purpose: "command",
})
export const PanelHeader = story({
  presentation: "panel",
  label: "Search",
  items: undefined,
  groups,
  searchSize: "large",
  purpose: "command",
  header: <Text purpose="caption">Recent</Text>,
})
export const Popover = popover({})
export const PopoverOpen = popover({ open: true })
export const PopoverMultiple = {
  render: () => (
    <OptionList
      selection="multiple"
      label="User"
      searchPlaceholder="Search by name or email…"
      emptyMessage="No matches."
      items={people}
      trigger={trigger}
      width="large"
      open
      value={["ada"]}
      onValueChange={() => undefined}
    />
  ),
}
export const PopoverTriggerWidth = popover({ width: "trigger", open: true })
export const PopoverSpacious = popover({ density: "spacious", header: "Assign to", open: true }, "alan")

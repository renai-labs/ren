import type { ComponentProps } from "react"
import { useState } from "react"
import {
  Menu,
  MenuCheckboxItem,
  MenuItem,
  MenuMessage,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSection,
  MenuSeparator,
  MenuSubmenu,
} from "ren-v1/composites/menu"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import meta from "../ui/menu.stories.js"

type Args = Omit<ComponentProps<typeof Menu>, "trigger">

const items = (
  <>
    <MenuItem icon={<Icon glyph="Pencil" />}>Rename</MenuItem>
    <MenuItem icon={<Icon glyph="Copy" />}>Duplicate</MenuItem>
    <MenuItem icon={<Icon glyph="Archive" />}>Archive</MenuItem>
  </>
)

export default {
  ...meta,
  component: Menu,
  args: { children: items },
  render: (args: Args) => <Menu trigger={<Button appearance="outline">Options</Button>} open {...args} />,
}

export const Default = {}
export const Closed = {
  render: (args: Args) => <Menu trigger={<Button appearance="outline">Options</Button>} {...args} />,
}
export const Danger = {
  args: {
    children: (
      <>
        <MenuItem icon={<Icon glyph="Pencil" />}>Rename</MenuItem>
        <MenuSeparator />
        <MenuItem tone="danger" icon={<Icon glyph="Trash2" />}>
          Delete
        </MenuItem>
      </>
    ),
  },
}
export const Disabled = {
  args: {
    children: (
      <>
        <MenuItem icon={<Icon glyph="Pencil" />}>Rename</MenuItem>
        <MenuItem icon={<Icon glyph="Archive" />} disabled>
          Archive
        </MenuItem>
      </>
    ),
  },
}
export const Shortcuts = {
  args: {
    children: (
      <>
        <MenuItem shortcut="⌘C">Copy</MenuItem>
        <MenuItem shortcut="⌘V">Paste</MenuItem>
      </>
    ),
  },
}
export const Selected = {
  args: {
    children: (
      <>
        <MenuItem selected={false}>Light</MenuItem>
        <MenuItem selected>Dark</MenuItem>
        <MenuItem selected={false}>System</MenuItem>
      </>
    ),
  },
}
export const Detail = {
  args: {
    width: "medium",
    children: (
      <>
        <MenuItem detail="Fast">Claude Haiku</MenuItem>
        <MenuItem detail="Balanced">Claude Sonnet</MenuItem>
      </>
    ),
  },
}
export const Sections = {
  args: {
    children: (
      <>
        <MenuSection label="Session">
          <MenuItem icon={<Icon glyph="Pencil" />}>Rename</MenuItem>
          <MenuItem icon={<Icon glyph="Link2" />}>Copy link</MenuItem>
        </MenuSection>
        <MenuSeparator />
        <MenuSection label="Danger zone">
          <MenuItem tone="danger" icon={<Icon glyph="Trash2" />}>
            Delete
          </MenuItem>
        </MenuSection>
      </>
    ),
  },
}
export const Checkboxes = { args: { children: <CheckboxItems /> } }
export const Radios = { args: { children: <RadioItems /> } }
export const Submenu = {
  args: {
    width: "medium",
    children: (
      <>
        <MenuItem icon={<Icon glyph="Pencil" />}>Rename</MenuItem>
        <MenuSubmenu icon={<Icon glyph="Folder" />} detail="Inbox" label="Move to" width="small">
          <MenuItem>Inbox</MenuItem>
          <MenuItem>Roadmap</MenuItem>
        </MenuSubmenu>
        <MenuSubmenu icon={<Icon glyph="User" />} description="Shrey and 2 others" label="Share with">
          <MenuItem>Everyone</MenuItem>
        </MenuSubmenu>
      </>
    ),
  },
}
export const Message = { args: { children: <MenuMessage>No models found</MenuMessage> } }
export const Spacious = {
  args: {
    width: "medium",
    density: "spacious",
    children: (
      <>
        <MenuSection label="Properties">
          <MenuSubmenu icon={<Icon glyph="Tag" />} detail="Any" label="Status">
            <MenuItem>Any</MenuItem>
          </MenuSubmenu>
          <RadioItems />
        </MenuSection>
        <MenuSeparator />
        <MenuItem icon={<Icon glyph="Clock" />}>Reset to default</MenuItem>
      </>
    ),
  },
}
export { Small, Medium, Large, TriggerWidth, AlignedEnd, AlignedCenter, Top } from "../ui/menu.stories.js"

function CheckboxItems() {
  const [days, setDays] = useState(["Mon", "Wed"])
  return ["Mon", "Tue", "Wed"].map((day) => (
    <MenuCheckboxItem
      key={day}
      checked={days.includes(day)}
      onCheckedChange={(checked) => setDays(checked ? [...days, day] : days.filter((entry) => entry !== day))}
    >
      {day}
    </MenuCheckboxItem>
  ))
}

function RadioItems() {
  const [sort, setSort] = useState("updated")
  return (
    <MenuRadioGroup value={sort} onValueChange={setSort}>
      <MenuRadioItem value="updated" icon={<Icon glyph="Clock" />}>
        Last updated
      </MenuRadioItem>
      <MenuRadioItem value="created" icon={<Icon glyph="Calendar" />}>
        Created
      </MenuRadioItem>
    </MenuRadioGroup>
  )
}

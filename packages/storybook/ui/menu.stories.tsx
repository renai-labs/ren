import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { Menu } from "@ren/ui/menu"

const meta = {
  component: Menu.Popup,
  args: {
    children: (
      <>
        <Menu.Item icon={<Icon glyph="Pencil" />}>Rename</Menu.Item>
        <Menu.Item icon={<Icon glyph="Copy" />}>Duplicate</Menu.Item>
        <Menu.Item icon={<Icon glyph="Archive" />}>Archive</Menu.Item>
      </>
    ),
  },
  render: (args) => (
    <Menu.Root defaultOpen>
      <Menu.Trigger render={<Button appearance="outline">Options</Button>} />
      <Menu.Popup {...args} />
    </Menu.Root>
  ),
  decorators: [
    (Story) => (
      <div className="flex h-80 items-start justify-center p-12">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Menu.Popup>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Closed: Story = {
  render: (args) => (
    <Menu.Root>
      <Menu.Trigger render={<Button appearance="outline">Options</Button>} />
      <Menu.Popup {...args} />
    </Menu.Root>
  ),
}
export const Danger: Story = {
  args: {
    children: (
      <>
        <Menu.Item icon={<Icon glyph="Pencil" />}>Rename</Menu.Item>
        <Menu.Separator />
        <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />}>
          Delete
        </Menu.Item>
      </>
    ),
  },
}
export const Disabled: Story = {
  args: {
    children: (
      <>
        <Menu.Item icon={<Icon glyph="Pencil" />}>Rename</Menu.Item>
        <Menu.Item icon={<Icon glyph="Archive" />} disabled>
          Archive
        </Menu.Item>
      </>
    ),
  },
}
export const Shortcuts: Story = {
  args: {
    children: (
      <>
        <Menu.Item shortcut="⌘C">Copy</Menu.Item>
        <Menu.Item shortcut="⌘V">Paste</Menu.Item>
      </>
    ),
  },
}
export const Selected: Story = { args: { children: <ThemeItems /> } }
export const Detail: Story = {
  args: {
    width: "medium",
    children: (
      <>
        <Menu.Item detail="Fast">Claude Haiku</Menu.Item>
        <Menu.Item detail="Balanced">Claude Sonnet</Menu.Item>
      </>
    ),
  },
}
export const Sections: Story = {
  args: {
    children: (
      <>
        <Menu.Section label="Session">
          <Menu.Item icon={<Icon glyph="Pencil" />}>Rename</Menu.Item>
          <Menu.Item icon={<Icon glyph="Link2" />}>Copy link</Menu.Item>
        </Menu.Section>
        <Menu.Separator />
        <Menu.Section label="Danger zone">
          <Menu.Item tone="danger" icon={<Icon glyph="Trash2" />}>
            Delete
          </Menu.Item>
        </Menu.Section>
      </>
    ),
  },
}
export const Checkboxes: Story = { args: { children: <CheckboxItems /> } }
export const Radios: Story = { args: { children: <RadioItems /> } }
export const Submenu: Story = {
  args: {
    width: "medium",
    children: (
      <>
        <Menu.Item icon={<Icon glyph="Pencil" />}>Rename</Menu.Item>
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger icon={<Icon glyph="Folder" />} detail="Inbox">
            Move to
          </Menu.SubmenuTrigger>
          <Menu.SubmenuPopup width="small">
            <Menu.Item>Inbox</Menu.Item>
            <Menu.Item>Roadmap</Menu.Item>
          </Menu.SubmenuPopup>
        </Menu.SubmenuRoot>
        <Menu.SubmenuRoot>
          <Menu.SubmenuTrigger icon={<Icon glyph="User" />} description="Shrey and 2 others">
            Share with
          </Menu.SubmenuTrigger>
          <Menu.SubmenuPopup>
            <Menu.Item>Everyone</Menu.Item>
          </Menu.SubmenuPopup>
        </Menu.SubmenuRoot>
      </>
    ),
  },
}
export const Message: Story = { args: { children: <Menu.Message>No models found</Menu.Message> } }
export const Spacious: Story = {
  args: {
    width: "medium",
    density: "spacious",
    children: (
      <>
        <Menu.Section label="Properties">
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger icon={<Icon glyph="Tag" />} detail="Any">
              Status
            </Menu.SubmenuTrigger>
            <Menu.SubmenuPopup>
              <Menu.Item>Any</Menu.Item>
            </Menu.SubmenuPopup>
          </Menu.SubmenuRoot>
          <RadioItems />
        </Menu.Section>
        <Menu.Separator />
        <Menu.Item icon={<Icon glyph="Clock" />}>Reset to default</Menu.Item>
      </>
    ),
  },
}
export const Small: Story = { args: { width: "small" } }
export const Medium: Story = { args: { width: "medium" } }
export const Large: Story = { args: { width: "large" } }
export const TriggerWidth: Story = { args: { width: "trigger" } }
export const AlignedEnd: Story = { args: { alignment: "end", width: "medium" } }
export const AlignedCenter: Story = { args: { alignment: "center", width: "medium" } }
export const Top: Story = {
  args: { placement: "top" },
  decorators: [
    (Story) => (
      <div className="flex h-full items-end">
        <Story />
      </div>
    ),
  ],
}

function CheckboxItems() {
  const [days, setDays] = useState(["Mon", "Wed"])
  return ["Mon", "Tue", "Wed"].map((day) => (
    <Menu.CheckboxItem
      key={day}
      checked={days.includes(day)}
      onCheckedChange={(checked) => setDays(checked ? [...days, day] : days.filter((entry) => entry !== day))}
    >
      {day}
    </Menu.CheckboxItem>
  ))
}

function RadioItems() {
  const [sort, setSort] = useState("updated")
  return (
    <Menu.RadioGroup value={sort} onValueChange={setSort}>
      <Menu.RadioItem value="updated" icon={<Icon glyph="Clock" />}>
        Last updated
      </Menu.RadioItem>
      <Menu.RadioItem value="created" icon={<Icon glyph="Calendar" />}>
        Created
      </Menu.RadioItem>
    </Menu.RadioGroup>
  )
}

function ThemeItems() {
  const [theme, setTheme] = useState("dark")
  return (
    <Menu.RadioGroup value={theme} onValueChange={setTheme}>
      <Menu.RadioItem value="light">Light</Menu.RadioItem>
      <Menu.RadioItem value="dark">Dark</Menu.RadioItem>
      <Menu.RadioItem value="system">System</Menu.RadioItem>
    </Menu.RadioGroup>
  )
}

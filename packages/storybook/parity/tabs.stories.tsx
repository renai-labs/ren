import type { StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import type { ComponentProps } from "react"
import { Tabs } from "ren-v1/composites/navigation"
import { Icon } from "../../ui/src/components/icon.js"

type PanelProps = Extract<ComponentProps<typeof Tabs<string>>, { purpose?: "panel" }>

export default {
  title: "Parity/Tabs",
  component: Tabs,
  args: {
    label: "Usage views",
    value: "overview",
    onValueChange: () => undefined,
    items: [
      { value: "overview", label: "Overview" },
      { value: "sessions", label: "Per session" },
      { value: "models", label: "Models" },
    ],
  },
  render: function Render(args: PanelProps) {
    const [value, setValue] = useState(args.value)
    return <Tabs {...args} value={value} onValueChange={setValue} />
  },
}

type Story = StoryObj<PanelProps>

export const Default: Story = {}
export const Unselected: Story = { args: { value: null } }
export const Small: Story = {
  args: {
    label: "Coding harness",
    size: "small",
    value: "opencode",
    items: [
      { value: "opencode", label: "OpenCode" },
      { value: "claude", label: "Claude Code" },
      { value: "codex", label: "Codex" },
    ],
  },
}
export const Counts: Story = {
  args: {
    label: "Members",
    value: "members",
    items: [
      { value: "members", label: "Members", count: 12 },
      { value: "invitations", label: "Invitations", count: 3 },
    ],
  },
}
export const Icons: Story = {
  args: {
    label: "Storage",
    value: "repositories",
    items: [
      { value: "repositories", label: "Repositories", icon: <Icon glyph="GitBranch" />, count: 4 },
      { value: "buckets", label: "Buckets", icon: <Icon glyph="Database" />, count: 2 },
    ],
  },
}
export const Navigation: StoryObj<typeof Tabs> = {
  render: () => (
    <Tabs
      purpose="navigation"
      label="Project pages"
      items={[
        { key: "overview", label: "Overview", link: <a href="#overview" aria-current="page" /> },
        { key: "tasks", label: "Tasks", link: <a href="#tasks" /> },
        { key: "settings", label: "Settings", link: <a href="#settings" /> },
      ]}
    />
  ),
}

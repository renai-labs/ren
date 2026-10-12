import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { Icon } from "@ren/ui/icon"
import { Tabs } from "@ren/ui/tabs"

const meta = {
  component: Tabs.Root<string>,
  args: { value: "overview", onValueChange: () => undefined, children: null },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <Tabs.Root value={value} onValueChange={setValue}>
        <Tabs.List label="Usage views">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="sessions">Per session</Tabs.Tab>
          <Tabs.Tab value="models">Models</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>
    )
  },
} satisfies Meta<typeof Tabs.Root<string>>

export default meta

type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Unselected: Story = { args: { value: null } }
export const Small: Story = {
  args: { value: "opencode" },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <Tabs.Root value={value} onValueChange={setValue}>
        <Tabs.List label="Coding harness" size="small">
          <Tabs.Tab value="opencode">OpenCode</Tabs.Tab>
          <Tabs.Tab value="claude">Claude Code</Tabs.Tab>
          <Tabs.Tab value="codex">Codex</Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>
    )
  },
}
export const Counts: Story = {
  args: { value: "members" },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <Tabs.Root value={value} onValueChange={setValue}>
        <Tabs.List label="Members">
          <Tabs.Tab value="members" count={12}>
            Members
          </Tabs.Tab>
          <Tabs.Tab value="invitations" count={3}>
            Invitations
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>
    )
  },
}
export const Icons: Story = {
  args: { value: "repositories" },
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <Tabs.Root value={value} onValueChange={setValue}>
        <Tabs.List label="Storage">
          <Tabs.Tab value="repositories" icon={<Icon glyph="GitBranch" />} count={4}>
            Repositories
          </Tabs.Tab>
          <Tabs.Tab value="buckets" icon={<Icon glyph="Database" />} count={2}>
            Buckets
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>
    )
  },
}
export const Panels: Story = {
  render: function Render(args) {
    const [value, setValue] = useState(args.value)
    return (
      <Tabs.Root value={value} onValueChange={setValue}>
        <Tabs.List label="Usage views">
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab value="sessions">Per session</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="overview">Spend across every session this month.</Tabs.Panel>
        <Tabs.Panel value="sessions">Spend broken down by session.</Tabs.Panel>
      </Tabs.Root>
    )
  },
}
export const Navigation: Story = {
  render: () => (
    <Tabs.Navigation label="Project pages">
      <Tabs.Link render={<a href="#overview" aria-current="page" />}>Overview</Tabs.Link>
      <Tabs.Link render={<a href="#tasks" />}>Tasks</Tabs.Link>
      <Tabs.Link render={<a href="#settings" />}>Settings</Tabs.Link>
    </Tabs.Navigation>
  ),
}

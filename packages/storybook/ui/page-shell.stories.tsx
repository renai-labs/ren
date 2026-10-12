import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "@ren/ui/button"
import { Icon } from "@ren/ui/icon"
import { PageShell } from "@ren/ui/page-shell"
import { Surface } from "@ren/ui/surface"
import { Text } from "@ren/ui/text"

const projects = ["Quarterly report", "Onboarding emails", "Pricing page", "Support triage"].map((name) => (
  <Surface.Panel key={name} padding="row">
    <Text purpose="label">{name}</Text>
  </Surface.Panel>
))

const meta = {
  component: PageShell.Root,
  args: {
    title: "Projects",
    subtitle: "Everything your team is building with Ren.",
    actions: <Button appearance="primary">New project</Button>,
    children: projects,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="flex h-180 w-320 flex-col overflow-hidden">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PageShell.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Collection: Story = {}
export const Detail: Story = {
  args: {
    layout: "detail",
    heading: "entity",
    title: "Quarterly report",
    subtitle: "Created by Ada Lovelace · Updated 2 hours ago",
    media: <Icon glyph="Folder" size="large" tone="secondary" />,
    context: <Button appearance="ghost">Back to projects</Button>,
  },
}
export const Settings: Story = {
  args: {
    layout: "settings",
    title: "General",
    subtitle: undefined,
    actions: undefined,
    children: (
      <>
        <PageShell.Section title="Profile" description="How teammates see you across Ren.">
          <Surface.Panel padding="medium">
            <Text>Ada Lovelace</Text>
          </Surface.Panel>
        </PageShell.Section>
        <PageShell.Section title="Security" frame="divided">
          <Text>Password</Text>
          <Text>Two-factor authentication</Text>
        </PageShell.Section>
      </>
    ),
  },
}
export const Workspace: Story = { args: { layout: "workspace", title: "Tasks", subtitle: undefined } }
export const Board: Story = { args: { layout: "board", title: "Tasks", subtitle: undefined } }
export const Untitled: Story = { args: { title: undefined, subtitle: undefined, actions: undefined } }
export const WithScope: Story = { args: { scope: <Button size="small">All teams</Button> } }
export const WithNavigation: Story = {
  args: {
    navigation: (
      <>
        <Text purpose="label">Active</Text>
        <Button size="small">Filter</Button>
      </>
    ),
    toolbar: <Text tone="secondary">4 projects</Text>,
  },
}
export const Record: Story = {
  render: () => (
    <PageShell.Record
      banner={<Text purpose="heading">Draft the quarterly report</Text>}
      aside={
        <div className="flex flex-col gap-2">
          <Text purpose="label">Status</Text>
          <Text tone="secondary">In progress</Text>
        </div>
      }
    >
      <Text>Summarise revenue, churn and expansion for the last quarter.</Text>
    </PageShell.Record>
  ),
}
export const SectionDivided: Story = {
  render: () => (
    <PageShell.Root title="Account">
      <PageShell.Section title="Devices" description="Where you’re signed in." frame="divided">
        <Text>MacBook Pro · This device</Text>
        <Text>iPhone 17</Text>
      </PageShell.Section>
    </PageShell.Root>
  ),
}

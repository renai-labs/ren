import type { Meta, StoryObj } from "@storybook/react-vite"
import { Badge } from "./badge.js"
import { Card } from "./card.js"
import { IconButton } from "./icon-button.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

const meta = {
  title: "UI/Card",
  component: Card.Root,
  args: {
    title: "Release notes",
    description: "Draft the changelog for the next release and share it with the team.",
  },
  decorators: [
    (Story) => (
      <div className="grid w-80 p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Card.Root>

export default meta

type Story = StoryObj<typeof meta>

const media = <Icon glyph="Folder" size="large" tone="secondary" />

export const Tile: Story = {}
export const Feature: Story = { args: { layout: "feature", media } }
export const Row: Story = { args: { layout: "row", media, metadata: "2 files" } }
export const Compact: Story = { args: { density: "compact" } }
export const Spacious: Story = { args: { density: "spacious" } }
export const Muted: Story = { args: { emphasis: "muted" } }
export const Limited: Story = {
  args: { layout: "row", width: "limited", density: "compact", emphasis: "muted", media, description: "PDF" },
}
export const Button: Story = { args: { interaction: "button", label: "Open release notes" } }
export const Link: Story = {
  args: { interaction: "link", render: <a href="#release-notes" aria-label="Open release notes" />, media },
}
export const Selection: Story = { args: { interaction: "selection", selected: true } }
export const Unselected: Story = { args: { interaction: "selection", selected: false } }
export const Disabled: Story = { args: { interaction: "button", disabled: true } }
export const InlineMedia: Story = {
  args: { media: <Icon glyph="Folder" tone="secondary" />, mediaPlacement: "inline", badges: <Badge>3</Badge> },
}
export const Badges: Story = { args: { media, badges: <Badge tone="success">Live</Badge> } }
export const Metadata: Story = { args: { metadata: "Updated 2 hours ago" } }
export const Actions: Story = {
  args: {
    actions: (
      <IconButton label="Remove release notes">
        <Icon glyph="Trash2" />
      </IconButton>
    ),
  },
}
export const FooterActions: Story = {
  args: {
    metadata: "Updated 2 hours ago",
    actionPlacement: "footer",
    actions: (
      <IconButton label="Remove release notes">
        <Icon glyph="Trash2" />
      </IconButton>
    ),
  },
}
export const Footer: Story = { args: { footer: <Text purpose="caption">Shared with 3 people</Text> } }
export const Content: Story = {
  args: { children: <Text purpose="caption">Usage appears after the first request.</Text> },
}
export const Divided: Story = {
  render: () => (
    <Card.Divided>
      <Card.Header media={<Icon glyph="MessageCircle" tone="secondary" />}>Session</Card.Header>
      <Card.Section onSelect={() => undefined} label="Open the session" metadata="2m">
        Reviewing the pull request
      </Card.Section>
    </Card.Divided>
  ),
}
export const DividedSelected: Story = {
  render: () => (
    <Card.Divided selected>
      <Card.Header
        media={<Icon glyph="MessageCircle" tone="secondary" />}
        actions={
          <IconButton label="Stop the session" size="compact">
            <Icon glyph="X" />
          </IconButton>
        }
      >
        Session
      </Card.Header>
      <Card.Section onSelect={() => undefined} label="Open the session" metadata="2m">
        Reviewing the pull request
      </Card.Section>
    </Card.Divided>
  ),
}

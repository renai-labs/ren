import type { Meta, StoryObj } from "@storybook/react-vite"
import { Tabs } from "ren-v1/composites/navigation"
import { Toolbar } from "ren-v1/composites/controls"
import { Button } from "../../ui/src/components/button.js"
import { IconButton } from "../../ui/src/components/icon-button.js"
import { Icon } from "../../ui/src/components/icon.js"
import { Link } from "../../ui/src/components/link.js"

const actions = (
  <>
    <IconButton label="Refresh projects">
      <Icon glyph="RefreshCw" />
    </IconButton>
    <IconButton label="Filter projects">
      <Icon glyph="ListFilter" />
    </IconButton>
    <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />}>
      New project
    </Button>
  </>
)

const tabs = (size: "small" | "medium") => (
  <Tabs
    label="Members"
    size={size}
    value="members"
    onValueChange={() => undefined}
    items={[
      { value: "members", label: "Members", count: 12 },
      { value: "invitations", label: "Invitations", count: 3 },
    ]}
  />
)

export default {
  title: "Parity/Toolbar",
  component: Toolbar,
  args: { label: "Projects", children: actions },
  decorators: [
    (Story) => (
      <div className="w-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toolbar>

type Story = StoryObj<typeof Toolbar>

export const End: Story = {}
export const Split: Story = { args: { alignment: "split", leading: tabs("medium") } }
export const Small: Story = { args: { size: "small", alignment: "split", leading: tabs("small") } }
export const LeadingOnly: Story = { args: { leading: tabs("medium"), children: undefined } }
export const Disabled: Story = {
  args: {
    children: (
      <>
        <IconButton label="Refresh projects">
          <Icon glyph="RefreshCw" />
        </IconButton>
        <Button disabled size="small">
          Archive
        </Button>
        <Button size="small">Export</Button>
      </>
    ),
  },
}
export const WithLink: Story = {
  args: {
    children: (
      <>
        <Link appearance="quiet" href="#docs">
          View docs
        </Link>
        <Button size="small">Export</Button>
      </>
    ),
  },
}

import type { Meta, StoryObj } from "@storybook/react-vite"
import { Button } from "./button.js"
import { IconButton } from "./icon-button.js"
import { Icon } from "./icon.js"
import { Link } from "./link.js"
import { Tabs } from "./tabs.js"
import { Toolbar } from "./toolbar.js"

const actions = (
  <>
    <Toolbar.Button
      render={
        <IconButton label="Refresh projects">
          <Icon glyph="RefreshCw" />
        </IconButton>
      }
    />
    <Toolbar.Button
      render={
        <IconButton label="Filter projects">
          <Icon glyph="ListFilter" />
        </IconButton>
      }
    />
    <Toolbar.Button
      render={
        <Button appearance="primary" size="small" leadingIcon={<Icon glyph="Plus" />}>
          New project
        </Button>
      }
    />
  </>
)

const tabs = (size: "small" | "medium") => (
  <Tabs.Root value="members" onValueChange={() => undefined}>
    <Tabs.List label="Members" size={size}>
      <Tabs.Tab value="members" count={12}>
        Members
      </Tabs.Tab>
      <Tabs.Tab value="invitations" count={3}>
        Invitations
      </Tabs.Tab>
    </Tabs.List>
  </Tabs.Root>
)

const meta = {
  title: "UI/Toolbar",
  component: Toolbar.Root,
  args: { label: "Projects", children: actions },
  decorators: [
    (Story) => (
      <div className="w-160">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Toolbar.Root>

export default meta

type Story = StoryObj<typeof meta>

export const End: Story = {}
export const Split: Story = { args: { alignment: "split", leading: tabs("medium") } }
export const Small: Story = { args: { size: "small", alignment: "split", leading: tabs("small") } }
export const LeadingOnly: Story = { args: { leading: tabs("medium"), children: undefined } }
export const Disabled: Story = {
  args: {
    children: (
      <>
        <Toolbar.Button
          render={
            <IconButton label="Refresh projects">
              <Icon glyph="RefreshCw" />
            </IconButton>
          }
        />
        <Toolbar.Button disabled render={<Button size="small">Archive</Button>} />
        <Toolbar.Button render={<Button size="small">Export</Button>} />
      </>
    ),
  },
}
export const WithLink: Story = {
  args: {
    children: (
      <>
        <Toolbar.Link
          render={
            <Link appearance="quiet" href="#docs">
              View docs
            </Link>
          }
        />
        <Toolbar.Button render={<Button size="small">Export</Button>} />
      </>
    ),
  },
}

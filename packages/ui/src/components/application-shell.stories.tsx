import type { Meta, StoryObj } from "@storybook/react-vite"
import { useState } from "react"
import { ApplicationShell } from "./application-shell.js"
import { Button } from "./button.js"
import { IconButton } from "./icon-button.js"
import { Icon } from "./icon.js"
import { KeyboardKey } from "./keyboard-key.js"
import { Logotype } from "./logotype.js"
import { PageShell } from "./page-shell.js"
import { Surface } from "./surface.js"
import { Text } from "./text.js"

const chats = ["Quarterly report", "Onboarding emails", "Pricing page copy", "Support triage", "Release notes"]

const navigation = (
  <>
    <ApplicationShell.NavigationSection>
      <ApplicationShell.NavigationItem current icon={<Icon glyph="Home" />} label="Home" render={<a href="#home" />} />
      <ApplicationShell.NavigationItem
        icon={<Icon glyph="Search" />}
        label="Search"
        shortcut="Meta+K Control+K"
        trailing={<KeyboardKey>⌘K</KeyboardKey>}
      />
      <ApplicationShell.NavigationItem icon={<Icon glyph="ListChecks" />} label="Tasks" render={<a href="#tasks" />} />
      <ApplicationShell.NavigationItem
        icon={<Icon glyph="Settings" />}
        label="Settings"
        render={<a href="#settings" />}
      />
    </ApplicationShell.NavigationSection>
    <ApplicationShell.NavigationSection
      title="Chats"
      scrolling="contained"
      collapsedVisibility="hidden"
      actions={
        <IconButton label="New chat" size="compact">
          <Icon glyph="Plus" />
        </IconButton>
      }
    >
      {chats.map((chat, index) => (
        <ApplicationShell.NavigationItem
          key={chat}
          highlighted={index === 1}
          icon={<Icon glyph="MessageCircle" />}
          label={chat}
          render={<a href={`#chat-${index}`} />}
        />
      ))}
    </ApplicationShell.NavigationSection>
  </>
)

const page = (
  <PageShell.Root title="Home" subtitle="Pick up where you left off.">
    {chats.slice(0, 3).map((chat) => (
      <Surface.Panel key={chat} padding="row">
        <Text purpose="label">{chat}</Text>
      </Surface.Panel>
    ))}
  </PageShell.Root>
)

function Interactive(props: ApplicationShell.RootProps) {
  const [state, setState] = useState(props.state)
  return <ApplicationShell.Root {...props} state={state} onStateChange={setState} />
}

const meta = {
  title: "UI/Application Shell",
  component: ApplicationShell.Root,
  args: {
    mobile: false,
    state: "expanded",
    onStateChange: () => undefined,
    toggleShortcut: "⌘B",
    navigationHeader: (
      <div className="flex min-w-0 flex-1 items-center px-2 group-data-[state=collapsed]/navigation:hidden">
        <Logotype size="small" />
      </div>
    ),
    navigation,
    navigationFooter: (
      <Button appearance="ghost" width="full" alignment="start" leadingIcon={<Icon glyph="User" />}>
        Ada Lovelace
      </Button>
    ),
    children: page,
  },
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="h-180 w-320 overflow-hidden">
        <Story />
      </div>
    ),
  ],
  render: (args) => <Interactive {...args} />,
} satisfies Meta<typeof ApplicationShell.Root>

export default meta

type Story = StoryObj<typeof meta>

export const Expanded: Story = {}
export const Collapsed: Story = { args: { state: "collapsed" } }
export const Mobile: Story = {
  args: { mobile: true },
  decorators: [
    (Story) => (
      <div className="h-180 w-96 overflow-hidden">
        <Story />
      </div>
    ),
  ],
}
export const MobileOpen: Story = { ...Mobile, args: { mobile: true, defaultNavigationOpen: true } }

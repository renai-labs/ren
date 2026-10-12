import type { ComponentProps } from "react"
import { useState } from "react"
import { ApplicationShell } from "ren-v1/shells/application-shell"
import { IconButton } from "../../ui/src/components/icon-button.js"
import { Icon } from "../../ui/src/components/icon.js"
import { KeyboardKey } from "../../ui/src/components/keyboard-key.js"
import meta from "../../ui/src/components/application-shell.stories.js"

const chats = ["Quarterly report", "Onboarding emails", "Pricing page copy", "Support triage", "Release notes"]

const navigation = (
  <>
    <ApplicationShell.NavigationSection>
      <ApplicationShell.NavigationItem current icon={<Icon glyph="Home" />} label="Home" link={<a href="#home" />} />
      <ApplicationShell.NavigationItem
        icon={<Icon glyph="Search" />}
        label="Search"
        shortcut="Meta+K Control+K"
        trailing={<KeyboardKey>⌘K</KeyboardKey>}
      />
      <ApplicationShell.NavigationItem icon={<Icon glyph="ListChecks" />} label="Tasks" link={<a href="#tasks" />} />
      <ApplicationShell.NavigationItem
        icon={<Icon glyph="Settings" />}
        label="Settings"
        link={<a href="#settings" />}
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
          link={<a href={`#chat-${index}`} />}
        />
      ))}
    </ApplicationShell.NavigationSection>
  </>
)

const subscribeKeyDown = (listener: (event: KeyboardEvent) => void) => {
  window.addEventListener("keydown", listener)
  return () => window.removeEventListener("keydown", listener)
}

function Interactive(props: ComponentProps<typeof ApplicationShell>) {
  const [state, setState] = useState(props.state)
  return <ApplicationShell {...props} state={state} onStateChange={setState} />
}

export default {
  ...meta,
  title: "Parity/Application Shell",
  component: ApplicationShell,
  args: { ...meta.args, navigation, subscribeKeyDown },
  render: (args: ComponentProps<typeof ApplicationShell>) => <Interactive {...args} />,
}

export { Expanded, Collapsed, Mobile } from "../../ui/src/components/application-shell.stories.js"

import type { ClientCommand } from "@ren/chat"
import { Icon } from "@ren/ui/icon"
import { IconButton } from "@ren/ui/icon-button"
import { Menu } from "@ren/ui/menu"

export function ComposerAddMenu(props: {
  disabled: boolean
  populated: boolean
  commands: ReadonlyArray<ClientCommand.Suggestion>
  onCommands: () => void
  onCommand: (command: ClientCommand.Suggestion) => void
  onMention: () => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton
            label="Add to this chat"
            disabled={props.disabled}
            appearance="outline"
            shape="circle"
            glyphMotion="turn-when-open"
            size="medium"
          >
            <Icon glyph="Plus" />
          </IconButton>
        }
      />
      <Menu.Popup placement="top" alignment="start" width="medium" restoreFocus={false}>
        {props.populated && props.commands.length > 0 ? (
          <Menu.SubmenuRoot>
            <Menu.SubmenuTrigger icon={<Icon glyph="Developer" />}>Run a command</Menu.SubmenuTrigger>
            <Menu.SubmenuPopup>
              {props.commands.map((command) => (
                <Menu.Item key={command.value} detail={command.description} onSelect={() => props.onCommand(command)}>
                  /{command.trigger}
                </Menu.Item>
              ))}
            </Menu.SubmenuPopup>
          </Menu.SubmenuRoot>
        ) : (
          <Menu.Item
            icon={<Icon glyph="Developer" />}
            shortcut="/"
            disabled={props.commands.length === 0}
            onSelect={props.onCommands}
          >
            Run a command
          </Menu.Item>
        )}
        <Menu.Item icon={<Icon glyph="AtSign" />} shortcut="@" onSelect={props.onMention}>
          Mention an agent, skill or file
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}

import type { ClientCommand } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import { Button } from "@ren/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@ren/ui/dropdown-menu"
import { Icon } from "@ren/ui/icon"
import { Kbd } from "@ren/ui/kbd"
import { useState } from "react"
import { ComposerRepositories } from "./composer-repositories.js"

export function ComposerAddMenu(props: {
  disabled: boolean
  populated: boolean
  commands: ReadonlyArray<ClientCommand.Suggestion>
  onCommands: () => void
  onCommand: (command: ClientCommand.Suggestion) => void
  onMention: () => void
  sessionID: Session.ID
  addRepositories?: ComposerRepositories.Dialog | undefined
}) {
  const space = ComposerRepositories.useSpace(props.sessionID)
  const [adding, setAdding] = useState(false)
  const spaceId = space.spaceId
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="outline"
              size="icon"
              className="rounded-full data-popup-open:bg-secondary [&_svg]:transition-transform data-popup-open:[&_svg]:rotate-45"
              aria-label="Add to this chat"
              disabled={props.disabled}
            />
          }
        >
          <Icon glyph="Plus" />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-64" finalFocus={false}>
          <RunCommand
            populated={props.populated}
            commands={props.commands}
            onCommands={props.onCommands}
            onCommand={props.onCommand}
          />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={props.onMention}>
              <Icon glyph="AtSign" />
              Mention an agent, skill or file
              <Kbd className="ml-auto">@</Kbd>
            </DropdownMenuItem>
            {props.addRepositories && spaceId ? (
              <DropdownMenuItem disabled={!space.canAdd} onClick={() => setAdding(true)}>
                <Icon glyph="GitBranch" />
                Repositories
                {space.canAdd ? null : (
                  <span className="ml-auto max-w-1/2 truncate text-muted-foreground">
                    {ComposerRepositories.notAllowed}
                  </span>
                )}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {adding && spaceId && props.addRepositories
        ? props.addRepositories({ spaceId, onClose: () => setAdding(false) })
        : null}
    </>
  )
}

function RunCommand(props: {
  populated: boolean
  commands: ReadonlyArray<ClientCommand.Suggestion>
  onCommands: () => void
  onCommand: (command: ClientCommand.Suggestion) => void
}) {
  if (props.populated && props.commands.length > 0)
    return (
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Icon glyph="Developer" />
          Run a command
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          <DropdownMenuGroup>
            {props.commands.map((command) => (
              <DropdownMenuItem key={command.value} onClick={() => props.onCommand(command)}>
                /{command.trigger}
                <span className="ml-auto max-w-1/2 truncate text-muted-foreground">{command.description}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    )
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={props.commands.length === 0} onClick={props.onCommands}>
        <Icon glyph="Developer" />
        Run a command
        <Kbd className="ml-auto">/</Kbd>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

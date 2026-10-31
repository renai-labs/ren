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
import { toast } from "@ren/ui/toast"
import { IconApps, IconGitBranch, IconPaperclip, IconPlus, IconTerminal2 } from "@tabler/icons-react"
import { Kbd } from "@ren/ui/kbd"
import { useState } from "react"
import { ComposerRepositories } from "./composer-repositories.js"

export function ComposerAddMenu(props: {
  disabled: boolean
  populated: boolean
  commands: ReadonlyArray<ClientCommand.Suggestion>
  onCommands: () => void
  onCommand: (command: ClientCommand.Suggestion) => void
  onMention?: (() => void) | undefined
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
              size="icon-sm"
              className="rounded-full data-popup-open:bg-secondary [&_svg]:transition-transform data-popup-open:[&_svg]:rotate-45"
              aria-label="Add to this chat"
              disabled={props.disabled}
            />
          }
        >
          <IconPlus />
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="w-52" finalFocus={false}>
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => toast.add({ title: "Files can’t be attached yet" })}>
              <IconPaperclip className="text-muted-foreground" />
              Attach files
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <RunCommand
            populated={props.populated}
            commands={props.commands}
            onCommands={props.onCommands}
            onCommand={props.onCommand}
          />
          <DropdownMenuGroup>
            <DropdownMenuItem disabled={!props.onMention} onClick={props.onMention}>
              <IconApps className="text-muted-foreground" />
              Apps
              <Kbd className="ml-auto">@</Kbd>
            </DropdownMenuItem>
            {props.addRepositories && spaceId ? (
              <DropdownMenuItem disabled={!space.canAdd} onClick={() => setAdding(true)}>
                <IconGitBranch className="text-muted-foreground" />
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
          <IconTerminal2 className="text-muted-foreground" />
          Commands
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
        <IconTerminal2 className="text-muted-foreground" />
        Commands
        <Kbd className="ml-auto">/</Kbd>
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

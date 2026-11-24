import { Suspense, useState, type ReactElement, type ReactNode } from "react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@ren/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@ren/ui/popover"
import { Spinner } from "@ren/ui/spinner"
import { IconAgent } from "../icons/heroicons.js"
import { PersonAvatar } from "./person-avatar.js"
import { useAgents } from "../lib/use-agents.js"
import { useMembers } from "../lib/use-members.js"
import { Picker } from "./picker.js"
import { UnassignedIcon } from "./task-meta.js"

const none = "none"

interface Choice {
  readonly id: string
  readonly name: string
  readonly icon: ReactNode
}

function Options(props: {
  label: string
  search: string
  empty: string
  none: Choice
  choices: ReadonlyArray<Choice>
  value: string | null
  onChange: (id: string | null) => void
}) {
  return (
    <Command label={props.label} defaultValue={props.value ?? none} className={Picker.command}>
      <CommandInput placeholder={props.search} />
      <CommandList className="max-h-72 p-1">
        <CommandEmpty>{props.empty}</CommandEmpty>
        <CommandGroup>
          {[props.none, ...props.choices].map((choice) => (
            <CommandItem
              key={choice.id}
              value={choice.id}
              keywords={[choice.name]}
              className="gap-2"
              data-checked={(props.value ?? none) === choice.id}
              onSelect={() => props.onChange(choice.id === none ? null : choice.id)}
            >
              {choice.icon}
              {choice.name}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function AgentOptions(props: { value: string | null; spaceId: string; onChange: (agentId: string | null) => void }) {
  const agents = useAgents(props.spaceId).agents
  return (
    <Options
      label="Agent"
      search="Search agents…"
      empty="No agent matches."
      none={{ id: none, name: "No agent", icon: <IconAgent className="text-muted-foreground/50" /> }}
      choices={agents.map((agent) => ({ id: agent.id, name: agent.name, icon: <IconAgent /> }))}
      value={props.value}
      onChange={props.onChange}
    />
  )
}

function PersonOptions(props: { value: string | null; onChange: (ownerId: string | null) => void }) {
  const members = useMembers().members
  return (
    <Options
      label="Assignee"
      search="Search people…"
      empty="No one matches."
      none={{ id: none, name: "No assignee", icon: <UnassignedIcon /> }}
      choices={members.map((member) => ({
        id: member.id,
        name: member.name,
        icon: <PersonAvatar name={member.name} image={member.image} />,
      }))}
      value={props.value}
      onChange={props.onChange}
    />
  )
}

function PickerPopover(props: {
  trigger: ReactElement
  children: ReactNode
  options: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={props.trigger}>{props.children}</PopoverTrigger>
      <PopoverContent align="start" className="w-60 gap-0 p-0">
        <Suspense fallback={<Spinner className="m-4 self-center" />}>{props.options(() => setOpen(false))}</Suspense>
      </PopoverContent>
    </Popover>
  )
}

export function TaskAgentPicker(props: {
  value: string | null
  spaceId: string
  trigger: ReactElement
  children: ReactNode
  onChange: (agentId: string | null) => void
}) {
  return (
    <PickerPopover
      trigger={props.trigger}
      options={(close) => (
        <AgentOptions
          value={props.value}
          spaceId={props.spaceId}
          onChange={(agentId) => {
            close()
            props.onChange(agentId)
          }}
        />
      )}
    >
      {props.children}
    </PickerPopover>
  )
}

export function TaskPersonPicker(props: {
  value: string | null
  trigger: ReactElement
  children: ReactNode
  onChange: (ownerId: string | null) => void
}) {
  return (
    <PickerPopover
      trigger={props.trigger}
      options={(close) => (
        <PersonOptions
          value={props.value}
          onChange={(ownerId) => {
            close()
            props.onChange(ownerId)
          }}
        />
      )}
    >
      {props.children}
    </PickerPopover>
  )
}

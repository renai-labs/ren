import { useEffect, useRef, useState, type ComponentType } from "react"
import { ToolDisplay } from "@ren/chat"
import type { SessionMessage } from "@ren/schema/session/message"
import {
  IconCode,
  IconFileText,
  IconFilter2,
  IconGhost,
  IconMessage,
  IconPencil,
  IconPlayerPlay,
  IconSearch,
  IconSparkles,
  IconTool,
  IconWorld,
} from "@tabler/icons-react"
import { DateTime } from "effect"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { cn } from "@/lib/utils"

type Kind = "user" | "message" | ToolDisplay.Kind
type Status = ToolDisplay.Status

interface Entry {
  readonly id: string
  readonly at: number
  readonly kind: Kind
  readonly label: string
  readonly detail: string
  readonly status?: Status | undefined
  readonly repeat: number
}

const kinds: ReadonlyArray<{ value: Kind; label: string; icon: ComponentType<{ className?: string }> }> = [
  { value: "user", label: "Your messages", icon: IconMessage },
  { value: "message", label: "Ren messages", icon: IconSparkles },
  { value: "command", label: "Commands", icon: IconCode },
  { value: "edit", label: "Edits", icon: IconPencil },
  { value: "file", label: "Reads", icon: IconFileText },
  { value: "search", label: "Searches", icon: IconSearch },
  { value: "web", label: "Web", icon: IconWorld },
  { value: "agent", label: "Subagents", icon: IconGhost },
  { value: "tool", label: "Tools", icon: IconTool },
]

const icons = new Map(kinds.map((each) => [each.value, each.icon]))

const statuses: ReadonlyArray<{ value: Status; label: string }> = [
  { value: "running", label: "Running" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
]

const verbs: Record<ToolDisplay.Kind, string> = {
  command: "Executed command",
  edit: "Edited",
  file: "Read",
  search: "Searched",
  web: "Fetched",
  agent: "Delegated",
  tool: "Called",
}

const aliases: Readonly<Record<string, Kind>> = { shell: "command", cmd: "command", read: "file", app: "tool" }

const millis = (time: DateTime.Utc) => DateTime.toEpochMillis(time)

const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

const entriesOf = (messages: ReadonlyArray<SessionMessage.Info>): ReadonlyArray<Entry> =>
  messages
    .flatMap((message): ReadonlyArray<Omit<Entry, "repeat">> => {
      if (message.type === "user")
        return [{ id: message.id, at: millis(message.time.created), kind: "user", label: message.text, detail: "" }]
      if (message.type === "shell")
        return [
          {
            id: message.id,
            at: millis(message.time.created),
            kind: "command",
            label: verbs.command,
            detail: message.command,
            status: message.status === "running" ? "running" : message.exit === 0 ? "completed" : "failed",
          },
        ]
      if (message.type !== "assistant") return []
      return message.content.flatMap((content, index): ReadonlyArray<Omit<Entry, "repeat">> => {
        if (content.type === "text" && content.text.trim())
          return [
            {
              id: `${message.id}:${index}`,
              at: millis(message.time.created),
              kind: "message",
              label: "Ren message",
              detail: content.text.replaceAll(/\s+/gu, " ").trim(),
            },
          ]
        if (content.type !== "tool" || ToolDisplay.hidden(content)) return []
        const kind = ToolDisplay.kind(content)
        return [
          {
            id: `${message.id}:${index}`,
            at: millis(content.time.created),
            kind,
            label: kind === "tool" ? `Called ${ToolDisplay.name(content)}` : verbs[kind],
            detail: ToolDisplay.subtitle(content) ?? "",
            status: ToolDisplay.status(content),
          },
        ]
      })
    })
    .reduce<Entry[]>((all, entry) => {
      const last = all.at(-1)
      if (last && last.kind === entry.kind && last.label === entry.label && last.detail === entry.detail)
        all.splice(-1, 1, { ...last, status: entry.status, repeat: last.repeat + 1 })
      else all.push({ ...entry, repeat: 1 })
      return all
    }, [])

const parse = (query: string) => {
  const tokens = query
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .map((token) => {
      const negate = token.startsWith("-")
      const [key = "", value = ""] = (negate ? token.slice(1) : token).split(":")
      return { token, negate, key, value }
    })
  const pick = (key: string, negate: boolean) =>
    tokens.filter((each) => each.key === key && each.value && each.negate === negate).map((each) => each.value)
  return {
    kinds: pick("type", false).map((value) => aliases[value] ?? value),
    withoutKinds: pick("type", true).map((value) => aliases[value] ?? value),
    statuses: pick("status", false),
    withoutStatuses: pick("status", true),
    words: tokens
      .filter((each) => !(each.value && (each.key === "type" || each.key === "status")))
      .map((each) => each.token.toLowerCase()),
  }
}

const dot: Record<Status, string> = {
  running: "bg-chart-1 motion-safe:animate-pulse",
  completed: "bg-chart-2",
  failed: "bg-chart-4",
}

function FilterMenu<A extends string>(props: {
  label: string
  options: ReadonlyArray<{ value: A; label: string }>
  value: ReadonlyArray<A>
  onChange: (next: ReadonlyArray<A>) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" className={cn(props.value.length > 0 && "text-foreground")}>
            <IconFilter2 data-icon="inline-start" />
            {props.label}
            {props.value.length > 0 ? <span className="tabular-nums">{props.value.length}</span> : null}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          {props.options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.value}
              checked={props.value.includes(option.value)}
              onCheckedChange={(checked) =>
                props.onChange(
                  checked ? [...props.value, option.value] : props.value.filter((each) => each !== option.value),
                )
              }
            >
              {option.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ProgressTab(props: { messages: ReadonlyArray<SessionMessage.Info> }) {
  const [query, setQuery] = useState("")
  const [types, setTypes] = useState<ReadonlyArray<Kind>>([])
  const [states, setStates] = useState<ReadonlyArray<Status>>([])
  const [live, setLive] = useState(true)
  const list = useRef<HTMLDivElement>(null)
  const filters = parse(query)
  const entries = entriesOf(props.messages).filter(
    (entry) =>
      (types.length === 0 || types.includes(entry.kind)) &&
      (states.length === 0 || (entry.status !== undefined && states.includes(entry.status))) &&
      (filters.kinds.length === 0 || filters.kinds.includes(entry.kind)) &&
      !filters.withoutKinds.includes(entry.kind) &&
      (filters.statuses.length === 0 || (entry.status !== undefined && filters.statuses.includes(entry.status))) &&
      (entry.status === undefined || !filters.withoutStatuses.includes(entry.status)) &&
      filters.words.every((word) => `${entry.label} ${entry.detail}`.toLowerCase().includes(word)),
  )
  const count = entries.length
  useEffect(() => {
    const node = list.current
    if (live && node) node.scrollTop = node.scrollHeight
  }, [live, count])
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <IconSearch />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search or filter"
            placeholder="Search or filter (type:shell, -status:failed)…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        <FilterMenu label="Type" options={kinds} value={types} onChange={setTypes} />
        <FilterMenu label="Status" options={statuses} value={states} onChange={setStates} />
        <Button
          variant="outline"
          aria-pressed={live}
          className="aria-pressed:bg-secondary aria-pressed:text-foreground"
          onClick={() => setLive((current) => !current)}
        >
          <IconPlayerPlay data-icon="inline-start" />
          Live
        </Button>
      </div>
      {count === 0 ? (
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconSparkles />
            </EmptyMedia>
            <EmptyTitle>{props.messages.length === 0 ? "Nothing yet" : "No matching steps"}</EmptyTitle>
            <EmptyDescription>
              {props.messages.length === 0
                ? "Every message, command and tool call Ren makes shows up here."
                : "Try a different search or filter."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div
          ref={list}
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a log of steps, rows are divs
          role="log"
          aria-label="Progress"
          className="-mx-3 min-h-0 flex-1 scrollbar-thin overflow-y-auto overscroll-contain px-3"
          onScroll={(event) => {
            const node = event.currentTarget
            const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24
            if (live !== atBottom) setLive(atBottom)
          }}
        >
          {entries.map((entry) => {
            const Icon = icons.get(entry.kind) ?? IconTool
            return (
              <div
                key={entry.id}
                className="flex h-7 items-center gap-2.5 rounded-md px-1.5 text-sm hover:bg-muted"
                title={entry.detail || entry.label}
              >
                <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {clock.format(entry.at)}
                </span>
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className={cn("shrink-0", entry.kind === "user" && "min-w-0 flex-1 truncate")}>
                  {entry.label}
                </span>
                {entry.kind === "user" ? null : (
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-muted-foreground",
                      entry.kind !== "message" && "font-mono text-xs",
                    )}
                  >
                    {entry.detail}
                  </span>
                )}
                {entry.repeat > 1 ? (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">×{entry.repeat}</span>
                ) : null}
                <span className={cn("size-1.5 shrink-0 rounded-full", entry.status ? dot[entry.status] : "")} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

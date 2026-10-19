export * as Transcript from "./transcript.js"

import { Accordion } from "@base-ui/react/accordion"
import { lazy, Suspense, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { KeyboardEvent, ReactNode } from "react"
import { DiffView } from "../lib/diff-view.js"
import type { DiffHunk } from "../lib/diff-view.js"
import { flushSync } from "react-dom"
import { TranscriptDisclosure, TranscriptItem } from "../lib/list-transcript.js"
import { useStreamingText } from "../lib/streaming-text.js"
import { Badge } from "./badge.js"
import { Button } from "./button.js"
import { Markdown } from "./document.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { Notice } from "./notice.js"
import { Surface } from "./surface.js"
import { Text } from "./text.js"

export type { DiffHunk, DiffLine } from "../lib/diff-view.js"

const HighlightedDiff = lazy(() =>
  import("../lib/diff-highlight.js").then((module) => ({ default: module.HighlightedDiff })),
)

export type ResponseProps = {
  content: string
  streaming: boolean
  tone?: "primary" | "secondary"
  onOpenSession?: ((sessionID: string) => void) | undefined
}

export function Response(props: ResponseProps) {
  const text = useStreamingText(props.content, props.streaming)
  const secondary = props.tone === "secondary"
  const markdown = (
    <Markdown
      content={text.visible}
      source={text.animating ? "streaming" : "static"}
      reveal={text.animateText ? "gradual" : "none"}
      scale={secondary ? "compact" : "standard"}
      tone={props.tone ?? "primary"}
      onOpenSession={props.onOpenSession}
    />
  )
  return secondary ? (
    markdown
  ) : (
    <div data-searchable className="min-w-0">
      {markdown}
    </div>
  )
}

export type ReasoningProps = {
  content: string
  streaming: boolean
  heading?: string | undefined
  duration?: string | undefined
  defaultOpen?: boolean
}

export function Reasoning(props: ReasoningProps) {
  const [open, setOpen] = useState(props.defaultOpen ?? false)
  const title = props.streaming ? "Thinking" : "Thought"
  const live = props.streaming && !open ? props.heading : undefined
  const description = props.streaming ? live : props.duration
  return (
    <TranscriptDisclosure
      title={
        <Text purpose="label" tone="inherit" element="span" activity={props.streaming ? "shimmer" : "none"}>
          {title}
        </Text>
      }
      description={description}
      label={description ? `${title} ${description}` : title}
      open={open}
      onOpenChange={setOpen}
      disabled={!props.content.trim()}
    >
      <div className="py-1">
        <Response content={props.content} streaming={props.streaming} tone="secondary" />
      </div>
    </TranscriptDisclosure>
  )
}

export type ToolKind = "command" | "file" | "edit" | "search" | "web" | "agent" | "tool"

export type ToolStatus = "running" | "completed" | "failed"

export type ToolEntrance = "none" | "animated"

const toolGlyphs: Record<ToolKind, Glyph> = {
  command: "Code",
  file: "FileText",
  edit: "Pencil",
  search: "Search",
  web: "Globe",
  agent: "Ghost",
  tool: "Wrench",
}

export type ToolProps = {
  kind: ToolKind
  title: string
  subtitle?: string | undefined
  status: ToolStatus
  failure?: string | undefined
  defaultOpen?: boolean
  entrance?: ToolEntrance
  children?: ReactNode
}

function ToolSubtitle(props: { subtitle: string; command: boolean }) {
  if (!props.command) return <span title={props.subtitle}>{props.subtitle}</span>
  return (
    <Surface.Well depth="sunken" radius="small" element="span" title={props.subtitle}>
      <span className="px-2">
        <Text purpose="code" tone="inherit" element="span">
          {props.subtitle}
        </Text>
      </span>
    </Surface.Well>
  )
}

export function Tool(props: ToolProps) {
  return (
    <TranscriptDisclosure
      leading={<Icon glyph={toolGlyphs[props.kind]} />}
      title={
        <Text
          purpose="label"
          tone="inherit"
          element="span"
          activity={props.status === "running" ? "shimmer" : "none"}
          title={props.title}
        >
          {props.title}
        </Text>
      }
      description={
        props.subtitle ? <ToolSubtitle subtitle={props.subtitle} command={props.kind === "command"} /> : undefined
      }
      trailing={
        props.status === "failed" ? (
          <Text purpose="body" tone="danger" element="span">
            {props.failure ?? "Failed"}
          </Text>
        ) : undefined
      }
      label={`${props.title}${props.subtitle ? ` ${props.subtitle}` : ""}, ${props.status === "failed" ? (props.failure ?? "Failed").toLowerCase() : props.status}`}
      defaultOpen={props.defaultOpen ?? false}
      entrance={props.entrance ?? "none"}
    >
      <Surface.Well depth="recessed" radius="container">
        <div className="flex flex-col gap-3 p-3">{props.children}</div>
      </Surface.Well>
    </TranscriptDisclosure>
  )
}

export type ToolDetailProps = {
  label: string
  value: string
  appearance?: "code" | "text"
  follow?: boolean
}

export function ToolDetail(props: ToolDetailProps) {
  const section = useRef<HTMLElement>(null)
  const pinned = useRef(true)
  const follow = props.follow === true
  useLayoutEffect(() => {
    const element = section.current
    if (!follow || !element || !pinned.current) return
    element.scrollTop = element.scrollHeight
  }, [follow, props.value])
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Text purpose="caption" element="h4">
        {props.label}
      </Text>
      <section
        ref={section}
        aria-label={props.label}
        onScroll={(event) => {
          const element = event.currentTarget
          pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 2
        }}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the detail can overflow, so keyboard users need to reach it to scroll
        tabIndex={0}
        className="max-h-64 min-h-0 overflow-y-auto overscroll-contain rounded-small outline-none focus-visible:outline-2 focus-visible:outline-accent-primary"
      >
        <Text
          purpose={props.appearance === "code" ? "code" : "caption"}
          tone="secondary"
          element="div"
          wrapping="preserved"
        >
          {props.value}
        </Text>
      </section>
    </div>
  )
}

export type UserTextProps = {
  text: string
  highlights?: ReadonlyArray<{ start: number; end: number }>
}

export function UserText(props: UserTextProps) {
  const ranges = props.highlights ?? []
  const pieces = ranges.flatMap((range, index) => {
    const from = ranges[index - 1]?.end ?? 0
    return [
      { key: `text:${from}`, text: props.text.slice(from, range.start), highlight: false },
      { key: `mention:${range.start}`, text: props.text.slice(range.start, range.end), highlight: true },
    ]
  })
  const rest = props.text.slice(ranges.at(-1)?.end ?? 0)
  return (
    <Text wrapping="preserved">
      {pieces.map((piece) =>
        piece.highlight ? (
          <span key={piece.key} data-highlight="" className="font-medium text-accent-primary">
            {piece.text}
          </span>
        ) : (
          piece.text
        ),
      )}
      {rest}
    </Text>
  )
}

export type SubagentStatus = "delegating" | "running" | "completed" | "failed" | "denied"

export type SubagentProps = {
  title: string
  description?: string | undefined
  status: SubagentStatus
  background?: boolean
  needsInput?: boolean
  failure?: string | undefined
  retry?: string | undefined
  tools?: number
  activity?: string | undefined
  onOpen?: (() => void) | undefined
}

const subagentProblems: Partial<Record<SubagentStatus, string>> = { failed: "Failed", denied: "Denied" }

function SubagentState(props: SubagentProps) {
  if (props.needsInput === true)
    return (
      <Badge size="small" shape="pill">
        Needs input
      </Badge>
    )
  const failed = subagentProblems[props.status]
  const label = failed ?? (props.retry ? "Retrying" : undefined)
  if (!label) return null
  return (
    <Text purpose="body" tone="danger" element="span" title={failed ? (props.failure ?? failed) : props.retry}>
      {label}
    </Text>
  )
}

function SubagentTrailing(props: SubagentProps) {
  const tools = props.tools ?? 0
  return (
    <>
      <SubagentState {...props} />
      {tools > 0 ? (
        <Text purpose="caption" tone="inherit" element="span">
          {tools} {tools === 1 ? "tool call" : "tool calls"}
        </Text>
      ) : null}
      {props.onOpen ? <Icon glyph="ChevronRight" /> : null}
    </>
  )
}

const subagentDescription = (props: SubagentProps) =>
  props.description ? `${props.description}${props.background ? " (background)" : ""}` : undefined

export function Subagent(props: SubagentProps) {
  const running = props.status === "running" || props.status === "delegating"
  const title = props.status === "delegating" ? "Delegating…" : props.title
  const description = subagentDescription(props)
  return (
    <div data-testid="message-subagent-task" className="flex min-w-0 flex-col">
      <TranscriptItem
        disabled={!props.onOpen}
        {...(props.onOpen && { onActivate: props.onOpen })}
        leading={<Icon glyph="Ghost" />}
        title={
          <Text purpose="label" tone="inherit" element="span" activity={running ? "shimmer" : "none"}>
            {title}
          </Text>
        }
        description={description ? <span title={description}>{description}</span> : undefined}
        label={[title, description].filter(Boolean).join(" ") + (running ? ", running" : "")}
        trailing={<SubagentTrailing {...props} />}
      >
        {props.activity ? (
          <Text purpose="code" tone="inherit" truncation="single-line">
            └ {props.activity}
          </Text>
        ) : null}
      </TranscriptItem>
    </div>
  )
}

export type LinksProps = {
  label: string
  links: ReadonlyArray<string>
}

const linkLimit = 10

export function Links(props: LinksProps) {
  const [all, setAll] = useState(false)
  const first = useRef<HTMLAnchorElement>(null)
  const shown = all ? props.links : props.links.slice(0, linkLimit)
  const remaining = props.links.length - shown.length
  if (props.links.length === 0) return null
  return (
    <nav aria-label={props.label} className="flex min-w-0 flex-col gap-1">
      <ul className="flex min-w-0 flex-col gap-1">
        {shown.map((url, index) => (
          <li key={url} className="flex min-w-0">
            <a
              ref={index === linkLimit ? first : undefined}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-6 min-w-0 items-center gap-1 rounded-small text-xs text-accent-primary underline-offset-2 transition-standard hover:underline focus-visible:outline-2 focus-visible:outline-accent-primary [&_svg]:size-3 [&_svg]:shrink-0"
            >
              <span className="truncate">{url}</span>
              <Icon glyph="ExternalLink" />
            </a>
          </li>
        ))}
      </ul>
      {remaining > 0 ? (
        <span className="flex">
          <Button
            appearance="link"
            onClick={() => {
              flushSync(() => setAll(true))
              first.current?.focus()
            }}
          >
            {`Show ${remaining} more`}
          </Button>
        </span>
      ) : null}
    </nav>
  )
}

export type AnswersProps = {
  items: ReadonlyArray<{ question: string; answer: string }>
}

export function Answers(props: AnswersProps) {
  return (
    <dl className="flex min-w-0 flex-col gap-2">
      {props.items.map((item) => (
        <div key={item.question} className="flex min-w-0 flex-col gap-0.5">
          <Text purpose="caption" tone="secondary" element="dt">
            {item.question}
          </Text>
          <Text purpose="body" element="dd" wrapping="preserved">
            {item.answer}
          </Text>
        </div>
      ))}
    </dl>
  )
}

export type DiffProps = {
  file: string
  label?: string
  hunks: ReadonlyArray<DiffHunk>
}

export function Diff(props: DiffProps) {
  const label = props.label ?? `Changes in ${props.file}`
  return (
    <Suspense fallback={<DiffView label={label} hunks={props.hunks} />}>
      <HighlightedDiff file={props.file} label={label} hunks={props.hunks} />
    </Suspense>
  )
}

export type FileChangesProps = {
  placement?: "block" | "list-item"
  defaultOpen?: ReadonlyArray<string>
  children: ReactNode
}

const fileKeys: Readonly<Record<string, (index: number, count: number) => number>> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
}

function moveFileFocus(event: KeyboardEvent<HTMLDivElement>) {
  const move = fileKeys[event.key]
  const target = event.target
  if (!move || !(target instanceof HTMLElement) || target.dataset.slot !== "file-change-trigger") return
  const triggers = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-slot=file-change-trigger]")]
  const index = triggers.indexOf(target)
  if (index < 0) return
  event.preventDefault()
  triggers[move(index, triggers.length)]?.focus()
}

export function FileChanges(props: FileChangesProps) {
  return (
    <Accordion.Root
      multiple
      defaultValue={[...(props.defaultOpen ?? [])]}
      onKeyDown={moveFileFocus}
      role={props.placement === "list-item" ? "listitem" : undefined}
      className="flex min-w-0 flex-col"
    >
      {props.children}
    </Accordion.Root>
  )
}

export type FileChangeKind = "created" | "deleted" | "modified"

export type FileChangeProps = {
  path: string
  change: FileChangeKind
  additions: number
  deletions: number
  children?: ReactNode
}

const plural = (count: number, noun: string) => `${count} ${count === 1 ? noun : `${noun}s`}`

export function FileChange(props: FileChangeProps) {
  const name = props.path.split(/[\\/]/).at(-1) || props.path
  const directory = props.path.slice(0, props.path.length - name.length)
  const summary =
    props.change === "modified"
      ? `${plural(props.additions, "addition")}, ${plural(props.deletions, "deletion")}`
      : props.change
  return (
    <Accordion.Item value={props.path} className="flex min-w-0 flex-col">
      <Accordion.Header className="flex min-w-0">
        <Accordion.Trigger
          data-slot="file-change-trigger"
          aria-label={`${props.path}, ${summary}`}
          className="group/file flex min-h-8 w-full min-w-0 items-center gap-2 rounded-control px-2 py-1 text-start text-sm text-text-secondary transition-standard hover:bg-fill-primary hover:text-text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-primary"
        >
          <span className="flex shrink-0 items-center [&_svg]:size-3.5">
            <Icon glyph="FileCode" />
          </span>
          <span className="flex min-w-0 flex-1 items-center" title={props.path}>
            {directory ? (
              <span className="min-w-0 truncate [direction:rtl]">
                <bdi>{directory}</bdi>
              </span>
            ) : null}
            <span className="shrink-0 font-medium text-text-primary">{name}</span>
          </span>
          {props.change === "modified" ? (
            <span className="flex shrink-0 items-center gap-1 font-mono text-xs tabular-nums">
              <span className="text-status-success">+{props.additions}</span>
              <span className="text-status-danger">-{props.deletions}</span>
            </span>
          ) : (
            <Text purpose="caption" tone={props.change === "created" ? "success" : "danger"} element="span">
              {props.change === "created" ? "Created" : "Deleted"}
            </Text>
          )}
          <span className="flex shrink-0 transition-standard group-data-panel-open/file:rotate-90 motion-reduce:transition-none [&_svg]:size-3.5">
            <Icon glyph="ChevronRight" />
          </span>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Panel className="flex min-w-0 flex-col gap-2 pt-1 pb-2">{props.children}</Accordion.Panel>
    </Accordion.Item>
  )
}

export type ToolGroupProps = {
  title: string
  working: boolean
  defaultOpen?: boolean
  children: ReactNode
}

export function ToolGroup(props: ToolGroupProps) {
  const [choice, setChoice] = useState<{ working: boolean; open: boolean }>()
  const open = props.working || (choice?.working === props.working ? choice.open : (props.defaultOpen ?? false))
  return (
    <TranscriptDisclosure
      appearance="summary"
      leading={<Icon glyph="Clock" />}
      title={
        <Text purpose="label" tone="inherit" element="span" activity={props.working ? "shimmer" : "none"}>
          {props.title}
        </Text>
      }
      label={props.working ? `${props.title}, running` : props.title}
      open={open}
      locked={props.working}
      onOpenChange={(next) => setChoice({ working: props.working, open: next })}
    >
      {props.children}
    </TranscriptDisclosure>
  )
}

export type WorkingProps = {
  label?: string
}

export function Working(props: WorkingProps) {
  return (
    <output aria-atomic="true" className="flex min-w-0 items-center py-1">
      <Text purpose="body" tone="secondary" element="span">
        <Text purpose="label" activity="shimmer" element="span">
          {props.label ?? "Preparing the next step"}
        </Text>
      </Text>
    </output>
  )
}

const seconds: {
  readonly listeners: Set<() => void>
  timer: ReturnType<typeof setInterval> | undefined
  now: number
} = { listeners: new Set(), timer: undefined, now: Date.now() }

function subscribeSeconds(listener: () => void) {
  seconds.listeners.add(listener)
  if (!seconds.timer) {
    seconds.now = Date.now()
    seconds.timer = setInterval(() => {
      seconds.now = Date.now()
      for (const each of seconds.listeners) each()
    }, 1000)
  }
  return () => {
    seconds.listeners.delete(listener)
    if (seconds.listeners.size > 0) return
    clearInterval(seconds.timer)
    seconds.timer = undefined
  }
}

function readSeconds() {
  return seconds.now
}

export type RetryProps = {
  attempt: number
  message: string
  next: number
}

export function Retry(props: RetryProps) {
  const now = useSyncExternalStore(subscribeSeconds, readSeconds, readSeconds)
  const remaining = Math.max(0, Math.round((props.next - now) / 1000))
  return (
    <Notice tone="warning" title={props.message}>
      <Text purpose="caption" activity="shimmer" element="span">
        {remaining > 0
          ? `Attempt ${props.attempt}, retrying in ${remaining}s`
          : `Attempt ${props.attempt}, retrying now`}
      </Text>
    </Notice>
  )
}

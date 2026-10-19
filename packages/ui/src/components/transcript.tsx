export * as Transcript from "./transcript.js"

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import type { ReactNode } from "react"
import { TranscriptDisclosure } from "../lib/list-transcript.js"
import { useStreamingText } from "../lib/streaming-text.js"
import { Markdown } from "./document.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { Notice } from "./notice.js"
import { Surface } from "./surface.js"
import { Text } from "./text.js"

export type ResponseProps = {
  content: string
  streaming: boolean
  tone?: "primary" | "secondary"
}

export function Response(props: ResponseProps) {
  const text = useStreamingText(props.content, props.streaming)
  const secondary = props.tone === "secondary"
  return (
    <Markdown
      content={text.visible}
      source={text.animating ? "streaming" : "static"}
      reveal={text.animateText ? "gradual" : "none"}
      scale={secondary ? "compact" : "standard"}
      tone={props.tone ?? "primary"}
    />
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

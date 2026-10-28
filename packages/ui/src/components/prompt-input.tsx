export * as PromptInput from "./prompt-input.js"

import {
  IconArrowDown,
  IconArrowUp,
  IconArrowsSort,
  IconClipboardText,
  IconGripVertical,
  IconPlayerStopFilled,
  IconRestore,
  IconX,
} from "@tabler/icons-react"
import { cn } from "cn"
import { createContext, Fragment, use, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { ComponentProps, KeyboardEvent, PointerEvent, ReactNode, Ref } from "react"
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "./attachment.js"
import { Button } from "./button.js"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu.js"
import { InputGroup, InputGroupTextarea } from "./input-group.js"
import { Kbd } from "./kbd.js"
import { Spinner } from "./spinner.js"

const ListboxContext = createContext<string | undefined>(undefined)

export function Root(props: { label: string; onSubmit: () => void; className?: string; children: ReactNode }) {
  const listbox = useId()
  return (
    <ListboxContext value={listbox}>
      <form
        data-slot="prompt-input"
        aria-label={props.label}
        onSubmit={(event) => {
          event.preventDefault()
          props.onSubmit()
        }}
        className={cn("relative flex w-full min-w-0 flex-col gap-2", props.className)}
      >
        {props.children}
      </form>
    </ListboxContext>
  )
}

export type Layout = "stacked" | "inline"

export function Group(props: { layout: Layout; className?: string; children: ReactNode }) {
  return (
    <InputGroup
      data-layout={props.layout}
      className={cn(
        "h-auto bg-card shadow-composer transition-shadow focus-within:shadow-composer-focus has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card",
        props.layout === "stacked" ? "rounded-xl" : "min-h-12 rounded-3xl pl-1",
        props.className,
      )}
    >
      {props.children}
    </InputGroup>
  )
}

export type MentionRange = {
  start: number
  end: number
  label: string
  icon?: ReactNode
  color?: string | undefined
}

function Mention(props: { mention: MentionRange; text: string }) {
  const mention = props.mention
  return (
    <span
      data-slot="prompt-input-mention"
      style={mention.color ? { color: mention.color } : undefined}
      className="relative rounded-sm bg-secondary [box-decoration-break:clone] font-medium text-foreground ring-2 ring-secondary"
    >
      <span className="text-transparent">{props.text.slice(mention.start, mention.end - mention.label.length)}</span>
      {mention.icon ? (
        <span className="absolute top-1/2 left-0 inline-grid size-4 -translate-y-1/2 place-items-center overflow-hidden rounded-sm text-foreground [&_img]:size-4 [&_img]:object-cover [&_svg]:size-3.5">
          {mention.icon}
        </span>
      ) : null}
      {mention.label}
    </span>
  )
}

function Highlights(props: { text: string; mentions: ReadonlyArray<MentionRange> }) {
  const ordered = props.mentions.toSorted((left, right) => left.start - right.start)
  return (
    <span>
      {ordered.map((mention, index) => (
        <Fragment key={mention.start}>
          {props.text.slice(index === 0 ? 0 : (ordered[index - 1]?.end ?? 0), mention.start)}
          <Mention mention={mention} text={props.text} />
        </Fragment>
      ))}
      {props.text.slice(ordered.at(-1)?.end ?? 0)}
      {props.text.endsWith("\n") ? "\u200b" : null}
    </span>
  )
}

const suggestionID = (listbox: string, value: string) => `${listbox}-${encodeURIComponent(value)}`

function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  if (event.repeat) return
  const form = event.currentTarget.form
  if (form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return
  form?.requestSubmit()
}

const textareaLayout: Record<Layout, string> = {
  stacked: "min-h-16 px-4 pt-4 pb-2",
  inline: "min-h-0 px-2 py-3",
}

const paddingOf = (layout: Layout, size: "default" | "lg" | undefined) =>
  cn(
    "text-base/relaxed md:text-sm/relaxed",
    textareaLayout[layout],
    layout === "stacked" && size === "lg" && "min-h-24",
  )

function suggestionAttributes(listbox: string | undefined, active: string | undefined) {
  if (!listbox) return {}
  return {
    "aria-autocomplete": "list" as const,
    "aria-controls": listbox,
    ...(active && { "aria-activedescendant": suggestionID(listbox, active) }),
  }
}

function assignRef<T>(ref: Ref<T> | undefined, node: T | null) {
  if (typeof ref === "function") return ref(node)
  if (ref) ref.current = node
}

export function Textarea(
  props: Omit<ComponentProps<"textarea">, "className" | "style" | "value"> & {
    value: string
    layout: Layout
    size?: "default" | "lg"
    mentions?: ReadonlyArray<MentionRange>
    suggesting?: boolean
    activeSuggestion?: string | undefined
    focusOnMount?: boolean
  },
) {
  const { layout, size, mentions, suggesting, activeSuggestion, focusOnMount, ref, onScroll, onKeyDown, ...rest } =
    props
  const listbox = use(ListboxContext)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const marked = (mentions?.length ?? 0) > 0
  const synchronize = () => {
    if (!input.current || !layer.current) return
    layer.current.scrollTop = input.current.scrollTop
  }
  useLayoutEffect(synchronize, [props.value, marked])
  useEffect(() => {
    const node = input.current
    if (!focusOnMount || !node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [focusOnMount])
  const padding = paddingOf(layout, size)
  return (
    <div data-slot="prompt-input-field" className="relative flex min-w-0 flex-1 self-stretch">
      {marked ? (
        <div
          ref={layer}
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 overflow-hidden wrap-break-word whitespace-pre-wrap text-foreground",
            padding,
          )}
        >
          <Highlights text={props.value} mentions={mentions ?? []} />
        </div>
      ) : null}
      <InputGroupTextarea
        {...suggestionAttributes(suggesting ? listbox : undefined, activeSuggestion)}
        {...(marked && { spellCheck: false })}
        ref={(node) => {
          input.current = node
          return assignRef(ref, node)
        }}
        onScroll={(event) => {
          synchronize()
          onScroll?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          submitOnEnter(event)
        }}
        rows={layout === "inline" ? 1 : undefined}
        className={cn(
          "relative max-h-60 placeholder:text-muted-foreground disabled:cursor-not-allowed",
          padding,
          layout === "inline" && !props.value && "field-sizing-fixed placeholder:truncate",
          marked && "text-transparent caret-foreground",
        )}
        {...rest}
      />
    </div>
  )
}

export type SuggestionKind = "agent" | "skill" | "file" | "app" | "command"

export type Suggestion = {
  value: string
  kind: SuggestionKind
  label: string
  description?: string | undefined
  icon?: ReactNode
}

const suggestionGroups: Record<SuggestionKind, string> = {
  agent: "Agents",
  skill: "Skills",
  file: "Files",
  app: "Apps",
  command: "Commands",
}

export function Suggestions(props: {
  label: string
  items: ReadonlyArray<Suggestion>
  active: string | undefined
  side?: "top" | "bottom"
  onActiveChange: (value: string) => void
  onSelect: (value: string) => void
}) {
  const listbox = use(ListboxContext)
  const list = useRef<HTMLDivElement>(null)
  const starts = props.items.flatMap((item, index) =>
    index === 0 || props.items[index - 1]?.kind !== item.kind ? [index] : [],
  )
  const groups = starts.map((start, index) => props.items.slice(start, starts[index + 1]))
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [props.active])
  return (
    <div
      id={listbox}
      ref={list}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the text field keeps focus and points into the options, which a <select> cannot do
      role="listbox"
      aria-label={props.label}
      className={cn(
        "absolute inset-x-0 z-50 flex max-h-72 min-h-0 flex-col overflow-y-auto overscroll-contain rounded-xl bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10",
        props.side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
      )}
    >
      {groups.map((group) => (
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- options inside a listbox group through role="group"; an <optgroup> needs a <select>
        <div key={group.at(0)?.value} role="group" aria-label={suggestionGroups[group.at(0)?.kind ?? "command"]}>
          <span aria-hidden="true" className="block px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {suggestionGroups[group.at(0)?.kind ?? "command"]}
          </span>
          {group.map((item) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the text field keeps focus and drives the options through aria-activedescendant
            <div
              key={item.value}
              id={listbox ? suggestionID(listbox, item.value) : undefined}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an <option> lives only inside a <select>, which cannot keep the text field focused
              role="option"
              aria-selected={item.value === props.active}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => {
                if (item.value !== props.active) props.onActiveChange(item.value)
              }}
              onClick={() => props.onSelect(item.value)}
              className="flex min-h-8 cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm select-none aria-selected:bg-muted [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
            >
              {item.icon}
              <span className="min-w-0 flex-1 truncate">
                <span className="font-medium text-foreground">{item.label}</span>
                {item.description ? <span className="text-muted-foreground"> {item.description}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function Submit(props: {
  running: boolean
  content: boolean
  disabled?: boolean
  starting?: boolean
  onStop: () => void
}) {
  if (props.starting)
    return (
      <Button
        type="submit"
        variant="secondary"
        size="icon-sm"
        aria-label="Starting session"
        aria-busy
        disabled
        className="rounded-full"
      >
        <Spinner />
      </Button>
    )
  const stop = (variant: "default" | "secondary") => (
    <Button
      variant={variant}
      size="icon-sm"
      aria-label="Stop"
      className="rounded-full"
      onClick={(event) => {
        event.preventDefault()
        props.onStop()
      }}
    >
      <IconPlayerStopFilled />
    </Button>
  )
  if (props.running && !props.content) return stop("default")
  const send = (
    <Button
      type="submit"
      variant={props.content ? "default" : "secondary"}
      size="icon-sm"
      aria-label="Send"
      className="rounded-full"
      disabled={props.disabled}
    >
      <IconArrowUp />
    </Button>
  )
  if (!props.running) return send
  return (
    <span className="flex items-center gap-2">
      {stop("secondary")}
      {send}
    </span>
  )
}

export function Alternate(props: { label: string; shortcut: string; description?: string; onActivate: () => void }) {
  return (
    <Button variant="ghost" size="xs" className="h-6.5" title={props.description} onClick={props.onActivate}>
      {props.label}
      <Kbd>{props.shortcut}</Kbd>
    </Button>
  )
}

const characters = new Intl.NumberFormat()

export function PastedText(props: {
  text: string
  disabled?: boolean
  onRemove: () => void
  onShowInTextField: () => void
}) {
  return (
    <Attachment size="sm">
      <AttachmentMedia>
        <IconClipboardText />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>Pasted text</AttachmentTitle>
        <AttachmentDescription className="tabular-nums">
          {characters.format(props.text.length)} characters
        </AttachmentDescription>
      </AttachmentContent>
      <AttachmentTrigger aria-label="Show in text field" disabled={props.disabled} onClick={props.onShowInTextField} />
      <AttachmentActions>
        <AttachmentAction aria-label="Remove pasted text" disabled={props.disabled} onClick={props.onRemove}>
          <IconX />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  )
}

type QueueDrag = { id: string; order: ReadonlyArray<string>; from: number; to: number }

type QueuePointer = {
  id: string
  pointer: number
  origin: number
  scroll: number
  order: ReadonlyArray<string>
  from: number
  middles: ReadonlyArray<number>
  active: boolean
}

const QueueContext = createContext<{
  drag: QueueDrag | undefined
  start: ((id: string, event: PointerEvent<HTMLElement>) => void) | undefined
  move: (event: PointerEvent<HTMLElement>) => void
  end: (event: PointerEvent<HTMLElement>, options: { readonly drop: boolean }) => void
}>({ drag: undefined, start: undefined, move: () => undefined, end: () => undefined })

const queueActivation = 4
const queueEdge = 0.05
const queueScrollStep = 8

const moved = (order: ReadonlyArray<string>, from: number, to: number) => {
  const item = order[from]
  if (item === undefined) return order
  const rest = order.filter((_, index) => index !== from)
  return [...rest.slice(0, to), item, ...rest.slice(to)]
}

export function Queue(props: {
  label: string
  count: number
  onReorder?: ((from: number, to: number) => void) | undefined
  children: ReactNode
}) {
  const list = useRef<HTMLUListElement>(null)
  const pointer = useRef<QueuePointer | undefined>(undefined)
  const [drag, setDrag] = useState<QueueDrag>()
  const onReorder = props.onReorder
  const target = (current: QueuePointer, node: HTMLElement, clientY: number) => {
    const y = clientY + node.scrollTop - current.scroll
    return current.middles.filter((middle, index) => index !== current.from && middle < y).length
  }
  const start = (id: string, event: PointerEvent<HTMLElement>) => {
    const node = list.current
    if (!node || event.button !== 0) return
    const rows = [...node.querySelectorAll<HTMLElement>("[data-queue-item]")]
    const order = rows.map((row) => row.dataset.queueItem ?? "")
    const from = order.indexOf(id)
    if (from < 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current = {
      id,
      pointer: event.pointerId,
      origin: event.clientY,
      scroll: node.scrollTop,
      order,
      from,
      middles: rows.map((row) => {
        const box = row.getBoundingClientRect()
        return box.top + box.height / 2
      }),
      active: false,
    }
  }
  const move = (event: PointerEvent<HTMLElement>) => {
    const current = pointer.current
    const node = list.current
    if (!current || !node || current.pointer !== event.pointerId) return
    if (!current.active && Math.abs(event.clientY - current.origin) < queueActivation) return
    current.active = true
    const box = node.getBoundingClientRect()
    const edge = box.height * queueEdge
    if (event.clientY < box.top + edge) node.scrollBy(0, -queueScrollStep)
    if (event.clientY > box.bottom - edge) node.scrollBy(0, queueScrollStep)
    const to = target(current, node, event.clientY)
    setDrag((previous) =>
      previous?.to === to ? previous : { id: current.id, order: current.order, from: current.from, to },
    )
  }
  const end = (event: PointerEvent<HTMLElement>, options: { readonly drop: boolean }) => {
    const current = pointer.current
    if (!current || current.pointer !== event.pointerId) return
    pointer.current = undefined
    setDrag(undefined)
    const node = list.current
    if (!options.drop || !current.active || !node) return
    const to = target(current, node, event.clientY)
    if (to !== current.from) onReorder?.(current.from, to)
  }
  return (
    <QueueContext value={{ drag, start: onReorder ? start : undefined, move, end }}>
      <section
        aria-label={props.label}
        data-slot="prompt-input-queue"
        className="-mb-4 flex min-w-0 flex-col rounded-t-xl border border-b-0 bg-card px-1 pt-1 pb-5"
      >
        {props.count > 3 ? (
          <span className="px-3 pt-1 text-xs text-muted-foreground tabular-nums">{props.label}</span>
        ) : null}
        <ul
          ref={list}
          className={cn(
            "flex min-w-0 flex-col",
            props.count > 4 && "max-h-37 overflow-y-auto overscroll-contain mask-b-from-80%",
          )}
        >
          {props.children}
        </ul>
      </section>
    </QueueContext>
  )
}

export type QueueItemProps = {
  text: string
  detail?: ReactNode
  actions?: "on-hover" | "visible"
  busy?: boolean
  sendLabel?: string
  onSend?: () => void
  onMove?: () => void
  onRemove?: () => void
  onMoveUp?: (() => void) | undefined
  onMoveDown?: (() => void) | undefined
}

function QueueReorder(props: {
  busy: boolean
  onMoveUp: (() => void) | undefined
  onMoveDown: (() => void) | undefined
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Reorder"
            className="text-muted-foreground"
            disabled={props.busy}
          />
        }
      >
        <IconArrowsSort />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuItem disabled={!props.onMoveUp} {...(props.onMoveUp && { onClick: props.onMoveUp })}>
            <IconArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!props.onMoveDown} {...(props.onMoveDown && { onClick: props.onMoveDown })}>
            <IconArrowDown />
            Move down
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function QueueActions(props: QueueItemProps) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5 transition-opacity",
        props.actions === "visible"
          ? "opacity-100"
          : "opacity-0 group-focus-within/queue:opacity-100 group-hover/queue:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100",
        props.busy && "pointer-events-none",
      )}
    >
      {props.onSend ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={props.sendLabel ?? "Send now"}
          className="text-muted-foreground"
          disabled={props.busy}
          onClick={props.onSend}
        >
          <IconArrowUp />
        </Button>
      ) : null}
      {props.onMove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Move to composer"
          className="text-muted-foreground"
          disabled={props.busy}
          onClick={props.onMove}
        >
          <IconRestore />
        </Button>
      ) : null}
      {props.onMoveUp || props.onMoveDown ? (
        <QueueReorder busy={props.busy === true} onMoveUp={props.onMoveUp} onMoveDown={props.onMoveDown} />
      ) : null}
      {props.onRemove ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Remove"
          className="text-muted-foreground"
          disabled={props.busy}
          onClick={props.onRemove}
        >
          <IconX />
        </Button>
      ) : null}
    </span>
  )
}

export function QueueItem(props: QueueItemProps) {
  const id = useId()
  const queue = use(QueueContext)
  const drag = queue.drag
  const position = drag ? moved(drag.order, drag.from, drag.to).indexOf(id) : -1
  const busy = props.busy === true
  return (
    <li
      data-slot="prompt-input-queue-item"
      data-queue-item={id}
      data-dragging={drag?.id === id ? "" : undefined}
      style={position < 0 ? undefined : { order: position }}
      className="group/queue flex min-h-8 min-w-0 items-center gap-2 rounded-lg px-2 text-sm data-dragging:opacity-50"
    >
      {queue.start ? (
        <span
          aria-hidden="true"
          onPointerDown={(event) => {
            if (!busy) queue.start?.(id, event)
          }}
          onPointerMove={queue.move}
          onPointerUp={(event) => queue.end(event, { drop: true })}
          onPointerCancel={(event) => queue.end(event, { drop: false })}
          className="flex shrink-0 cursor-grab touch-none items-center text-muted-foreground active:cursor-grabbing [&_svg]:size-4"
        >
          <IconGripVertical />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.text}</span>
      {props.detail ? <span className="shrink-0 text-xs text-muted-foreground">{props.detail}</span> : null}
      <QueueActions {...props} />
    </li>
  )
}

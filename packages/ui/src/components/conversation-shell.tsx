export * as ConversationShell from "./conversation-shell.js"

import { cva } from "class-variance-authority"
import {
  createContext,
  Fragment,
  use,
  useEffect,
  useEffectEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import type { ComponentPropsWithoutRef, KeyboardEvent, PointerEvent, ReactNode, Ref } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { assignRef, ShellContext } from "../lib/conversation-context.js"
import { JumpToLatest } from "../lib/conversation-timeline.js"
import { itemVariants, leadingSlot } from "../lib/list-chrome.js"
import { AttachmentTile } from "./attachment-tile.js"
import { Button } from "./button.js"
import { Icon } from "./icon.js"
import type { Glyph } from "./icon.js"
import { IconButton } from "./icon-button.js"
import { KeyboardKey } from "./keyboard-key.js"
import { Menu } from "./menu.js"
import { Surface } from "./surface.js"
import { Text } from "./text.js"

export { Timeline } from "../lib/conversation-timeline.js"
export type { TimelineHandle, TimelineHistory, TimelineProps } from "../lib/conversation-timeline.js"

export type Mode = "live" | "pending" | "read-only" | "replay"
export type ComposerPosition = "docked" | "centered"

export type RootProps = {
  mode?: Mode
  header?: ReactNode
  transcript?: ReactNode
  timeline?: ReactNode
  populated: boolean
  placeholder?: ReactNode
  interaction?: ReactNode
  composer?: ReactNode
  composerPosition?: ComposerPosition
  auxiliary?: ReactNode
  overlay?: ReactNode
  hidden?: boolean
  latest?: { visible: boolean; onActivate: () => void }
}

export function Root(props: RootProps) {
  const hidden = props.hidden ?? false
  const position = props.composerPosition ?? "docked"
  const [dock, setDock] = useState<HTMLDivElement | null>(null)
  return (
    <ShellContext value={{ dock, populated: props.populated }}>
      <div
        data-slot="conversation-shell"
        data-mode={props.mode ?? "live"}
        className="relative flex min-h-0 w-full flex-1 flex-row overflow-hidden"
      >
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div
            aria-hidden={hidden || undefined}
            inert={hidden}
            className={composeClasses("relative flex min-h-0 flex-1 flex-col", hidden && "invisible")}
          >
            {props.header ? (
              <div className="pointer-events-none absolute top-2 right-2 left-12 z-20 flex min-w-0 items-center gap-1 *:pointer-events-auto md:left-3">
                {props.header}
              </div>
            ) : null}
            {!props.populated && props.placeholder ? (
              <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                <div className="pointer-events-auto">{props.placeholder}</div>
              </div>
            ) : null}
            {position === "docked"
              ? (props.timeline ?? (
                  <Transcript populated={props.populated} latest={props.latest}>
                    {props.transcript}
                  </Transcript>
                ))
              : null}
            <Dock position={position} ref={setDock} interaction={props.interaction} composer={props.composer} />
          </div>
          {props.overlay ? <div className="absolute inset-0 flex min-h-0 flex-col">{props.overlay}</div> : null}
        </div>
        <Auxiliary>{props.auxiliary}</Auxiliary>
      </div>
    </ShellContext>
  )
}

function Transcript(props: { populated: boolean; latest: RootProps["latest"]; children: ReactNode }) {
  return (
    <>
      <div
        data-slot="transcript-viewport"
        className={composeClasses(
          "absolute inset-0 touch-pan-y scrollbar-gutter-both overflow-y-auto overscroll-contain",
          props.populated ? "bg-background-primary" : "bg-transparent",
        )}
      >
        <div className="mx-auto flex min-h-full max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] min-w-0 flex-col gap-4 px-4 pt-12 pb-6 md:gap-6 md:px-6">
          {props.children}
          <div className="min-h-6 min-w-6 shrink-0" />
        </div>
      </div>
      {props.latest ? <JumpToLatest {...props.latest} /> : null}
    </>
  )
}

function Dock({
  ref,
  ...props
}: {
  position: ComposerPosition
  ref: Ref<HTMLDivElement>
  interaction: ReactNode
  composer: ReactNode
}) {
  if (!props.interaction && !props.composer) return null
  const centered = props.position === "centered"
  const content = (
    <>
      {props.interaction}
      {props.composer}
    </>
  )
  const panel = (
    <div
      ref={ref}
      data-slot={centered ? undefined : "composer-dock"}
      className={
        centered
          ? "flex w-full max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] flex-col gap-2"
          : "pointer-events-none absolute inset-x-0 bottom-0 z-10 flex w-full flex-col items-center gap-2 bg-linear-to-t from-background-primary from-30% via-background-primary/disabled to-transparent px-4 pt-8 pb-3 *:pointer-events-auto *:w-full *:max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] md:px-6 md:pb-4"
      }
    >
      {content}
    </div>
  )
  if (!centered) return panel
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-2 md:px-4">{panel}</div>
  )
}

function Auxiliary(props: { children: ReactNode }) {
  if (!props.children) return null
  return (
    <div className="flex min-h-0 shrink-0 md:border-l md:border-border-primary">
      <div className="absolute inset-x-2 top-12 bottom-2 z-30 flex min-h-0 flex-col md:static md:my-2 md:mr-2 md:w-80 md:shrink-0 lg:w-96">
        {props.children}
      </div>
    </div>
  )
}

export type Author = "user" | "assistant"
export type Entrance = "none" | "animated"
export type ActionSpace = "collapsed" | "reserved"

const messageRowVariants = cva("group/message flex w-full items-start gap-3", {
  variants: { author: { user: "relative justify-end", assistant: "justify-start" } },
})

const messageColumnVariants = cva("flex min-w-0 flex-col gap-2", {
  variants: { author: { user: "max-w-5/6 items-end", assistant: "flex-1" } },
})

const messageContentVariants = cva("flex max-w-full min-w-0 flex-col gap-2", {
  variants: {
    author: { user: "items-end", assistant: "" },
    entrance: { none: "", animated: "animate-entrance" },
  },
  defaultVariants: { entrance: "none" },
})

const messageAvatarVariants = cva("flex size-6 shrink-0 overflow-hidden rounded-control bg-background-primary", {
  variants: {
    author: { user: "lg:absolute lg:-right-12", assistant: "" },
    header: { present: "", absent: "" },
  },
  compoundVariants: [
    { author: "user", header: "present", className: "mt-6 lg:top-6 lg:mt-0" },
    { author: "user", header: "absent", className: "lg:top-0" },
  ],
})

export type MessageProps = {
  author: Author
  avatar?: ReactNode
  sender?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  actionSpace?: ActionSpace
  entrance?: Entrance
  children: ReactNode
}

export function Message(props: MessageProps) {
  const identity = props.avatar !== undefined || props.sender !== undefined
  const sender = identity ? props.sender : null
  const header = sender || props.badge ? "present" : "absent"
  const avatar = identity ? <MessageAvatar author={props.author} header={header} avatar={props.avatar} /> : null
  return (
    <div data-slot="message" data-author={props.author} className={messageRowVariants({ author: props.author })}>
      {props.author === "assistant" ? avatar : null}
      <div className={messageColumnVariants({ author: props.author })}>
        {header === "present" ? <MessageHeader sender={sender} badge={props.badge} /> : null}
        <div className={messageContentVariants({ author: props.author, entrance: props.entrance })}>
          {props.children}
        </div>
        <MessageActions actions={props.actions} space={props.actionSpace} />
      </div>
      {props.author === "user" ? avatar : null}
    </div>
  )
}

function MessageHeader(props: { sender: ReactNode; badge: ReactNode }) {
  return (
    <div className="flex max-w-full min-w-0 items-center gap-2">
      {props.sender ? (
        <span className="min-w-0">
          <Text purpose="caption" tone="secondary" weight="medium" truncation="single-line" element="span">
            {props.sender}
          </Text>
        </span>
      ) : null}
      {props.badge ? <span className="shrink-0">{props.badge}</span> : null}
    </div>
  )
}

function MessageAvatar(props: { author: Author; header: "present" | "absent"; avatar: ReactNode }) {
  if (!props.avatar) return <span className="w-6 shrink-0" />
  return <span className={messageAvatarVariants({ author: props.author, header: props.header })}>{props.avatar}</span>
}

function MessageActions(props: { actions: ReactNode; space: ActionSpace | undefined }) {
  if (!props.actions)
    return props.space === "reserved" ? <div aria-hidden="true" data-slot="message-actions" className="h-7" /> : null
  return (
    <div
      data-slot="message-actions"
      className="flex items-center gap-1 opacity-0 transition-standard group-focus-within/message:opacity-100 group-hover/message:opacity-100"
    >
      {props.actions}
    </div>
  )
}

export type BubbleProps = {
  transitionName?: string
  children: ReactNode
} & Omit<ComponentPropsWithoutRef<"div">, "className" | "style" | "children">

export function Bubble(props: BubbleProps) {
  const { transitionName, children, ...rest } = props
  return (
    <div
      data-slot="message-bubble"
      style={transitionName ? { viewTransitionName: transitionName } : undefined}
      className="flex w-fit max-w-full min-w-0 flex-col gap-2 overflow-hidden rounded-container rounded-tr-control bg-fill-primary px-4 py-2 wrap-break-word text-text-primary select-text"
      {...rest}
    >
      {children}
    </div>
  )
}

export type ComposerLayout = "stacked" | "inline" | "adaptive"
type ResolvedLayout = Exclude<ComposerLayout, "adaptive">

const ComposerLayoutContext = createContext<{
  layout: ResolvedLayout
  measure: ((multiline: boolean) => void) | undefined
  listbox: string | undefined
}>({ layout: "stacked", measure: undefined, listbox: undefined })

const composerLayoutClasses: Record<ResolvedLayout, { form: string; input: string; status: string }> = {
  inline: {
    form: "flex-row items-end rounded-full",
    input: "grow basis-1/2",
    status: "top-1/2 left-2 -translate-y-1/2",
  },
  stacked: { form: "flex-col rounded-container", input: "flex-1", status: "top-4 left-4" },
}

export type ComposerProps = {
  layout?: ComposerLayout | undefined
  onSubmit: () => void
  label?: string
  header?: ReactNode
  queue?: ReactNode
  attachments?: ReactNode
  leading?: ReactNode
  trailing?: ReactNode
  footerLeading?: ReactNode
  footerTrailing?: ReactNode
  status?: ReactNode
  dropIndicator?: ReactNode
  suggestions?: ReactNode
  children: ReactNode
}

function resolveLayout(
  layout: ComposerLayout | undefined,
  content: { readonly multiline: boolean; readonly attachments: boolean },
): ResolvedLayout {
  if (layout === "adaptive") return content.multiline || content.attachments ? "stacked" : "inline"
  return layout ?? "stacked"
}

export function Composer(props: ComposerProps) {
  const [multiline, setMultiline] = useState(false)
  const listbox = useId()
  const layout = resolveLayout(props.layout, { multiline, attachments: Boolean(props.attachments) })
  return (
    <ComposerLayoutContext
      value={{
        layout,
        measure: props.layout === "adaptive" ? setMultiline : undefined,
        listbox: props.suggestions ? listbox : undefined,
      }}
    >
      <div className="relative flex w-full min-w-0 flex-col gap-2">
        {props.suggestions ? <div className="absolute inset-x-0 bottom-full z-50 mb-6">{props.suggestions}</div> : null}
        {props.header ? <div className="flex min-w-0 items-center px-1">{props.header}</div> : null}
        {props.queue ? <div className="-mb-6 flex min-w-0 flex-col px-3">{props.queue}</div> : null}
        <ComposerForm {...props} layout={layout} />
      </div>
    </ComposerLayoutContext>
  )
}

function ComposerForm(props: Omit<ComposerProps, "layout"> & { layout: ResolvedLayout }) {
  const inline = props.layout === "inline"
  const classes = composerLayoutClasses[props.layout]
  return (
    <form
      data-slot="composer"
      aria-label={props.label}
      style={{ viewTransitionName: "session-composer" }}
      onSubmit={(event) => {
        event.preventDefault()
        props.onSubmit()
      }}
      className={composeClasses(
        "relative flex w-full min-w-0 overflow-hidden border border-border-primary bg-background-secondary shadow-composer transition-standard focus-within:shadow-composer-focus",
        classes.form,
      )}
    >
      {props.attachments ? (
        <div
          data-testid="attachments-preview"
          className="flex w-full flex-row gap-2 overflow-x-auto overscroll-contain px-3 pt-3"
        >
          {props.attachments}
        </div>
      ) : null}
      {inline && props.leading ? (
        <div className="flex shrink-0 items-center self-end pb-2 pl-2">{props.leading}</div>
      ) : null}
      <div className={composeClasses("relative flex min-w-0 self-stretch", classes.input)}>
        {props.children}
        {props.status ? <div className={composeClasses("absolute z-10", classes.status)}>{props.status}</div> : null}
      </div>
      {inline && props.trailing ? <InlineControls>{props.trailing}</InlineControls> : null}
      {inline ? null : <ComposerFooter leading={props.footerLeading} trailing={props.footerTrailing} />}
      {props.dropIndicator ? (
        <output
          data-slot="drop-overlay"
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-container border-2 border-dashed border-border-strong bg-background-primary text-sm text-text-primary"
        >
          {props.dropIndicator}
        </output>
      ) : null}
    </form>
  )
}

function InlineControls(props: { children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })
  const measure = () => {
    const node = viewport.current
    if (!node) return
    const offset = Math.abs(node.scrollLeft)
    const start = offset > 1
    const end = node.scrollWidth - node.clientWidth - offset > 1
    setOverflow((previous) => (previous.start === start && previous.end === end ? previous : { start, end }))
  }
  const onResize = useEffectEvent(measure)
  useEffect(() => {
    const node = viewport.current
    if (!node) return
    const observer = new ResizeObserver(() => onResize())
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => observer.disconnect()
  }, [])
  return (
    <div
      ref={viewport}
      data-slot="composer-controls"
      data-overflow-start={overflow.start ? "" : undefined}
      data-overflow-end={overflow.end ? "" : undefined}
      onScroll={measure}
      className={composeClasses(
        "-mt-1 -ml-1 flex min-w-0 scrollbar-none self-end overflow-x-auto overscroll-x-contain pt-1 pr-2 pb-2 pl-1",
        "ltr:data-overflow-start:mask-l-from-[calc(100%-var(--ren-spacing-4))] rtl:data-overflow-start:mask-r-from-[calc(100%-var(--ren-spacing-4))]",
        "ltr:data-overflow-end:mask-r-from-[calc(100%-var(--ren-spacing-4))] rtl:data-overflow-end:mask-l-from-[calc(100%-var(--ren-spacing-4))]",
      )}
    >
      <div className="flex min-w-0 items-center gap-2">{props.children}</div>
    </div>
  )
}

function ComposerFooter(props: { leading: ReactNode; trailing: ReactNode }) {
  if (!props.leading && !props.trailing) return null
  return (
    <div className="flex items-center justify-between gap-1 px-3 pb-3">
      <div className="flex shrink-0 items-center gap-1">{props.leading}</div>
      <div className="flex min-w-0 items-center gap-2">{props.trailing}</div>
    </div>
  )
}

function submitOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
  event.preventDefault()
  if (event.repeat) return
  const form = event.currentTarget.form
  if (form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return
  form?.requestSubmit()
}

export type ComposerInputHeight = "content" | "standard"
export type ComposerInputOverlay = "none" | "highlight" | "preview"

const composerInputPadding: Record<ResolvedLayout, string> = {
  inline: "px-2 py-3",
  stacked: "px-4 pt-4 pb-2",
}

export type MentionKind = "agent" | "skill" | "file"

export type MentionRange = { start: number; end: number; kind: MentionKind; label: string }

export type ComposerInputProps = {
  focusOnMount?: boolean
  height?: ComposerInputHeight
  overlay?: ComposerInputOverlay
  overlayContent?: ReactNode
  mentions?: readonly MentionRange[]
  activeSuggestion?: string
  ref?: Ref<HTMLTextAreaElement>
} & Omit<ComponentPropsWithoutRef<"textarea">, "className" | "style">

export function ComposerInput(props: ComposerInputProps) {
  const {
    focusOnMount,
    height,
    overlay: overlayProp,
    overlayContent,
    mentions,
    activeSuggestion,
    ref,
    onScroll,
    onKeyDown,
    rows,
    ...attributes
  } = props
  const context = use(ComposerLayoutContext)
  const layout = context.layout
  const measure = context.measure
  const input = useRef<HTMLTextAreaElement | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const shown = overlayOf({ overlay: overlayProp, overlayContent, mentions, value: props.value })
  const overlay = shown.overlay
  const synchronize = () => {
    if (!input.current || !layer.current) return
    layer.current.scrollTop = input.current.scrollTop
    layer.current.scrollLeft = input.current.scrollLeft
  }
  useLayoutEffect(synchronize, [props.value, overlay])
  useEffect(() => {
    const node = input.current
    if (!focusOnMount || !node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [focusOnMount])
  useLayoutEffect(() => {
    const node = input.current
    if (!measure || !node) return
    if (!props.value) return measure(false)
    if (layout === "stacked") return
    const style = getComputedStyle(node)
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom)
    const lineHeight = Number.parseFloat(style.lineHeight) || 20
    if (node.scrollHeight - padding > lineHeight * 1.5) measure(true)
  }, [props.value, layout, measure])
  const padding = composerInputPadding[layout]
  return (
    <>
      {overlay === "none" ? null : (
        <div
          ref={layer}
          aria-hidden="true"
          data-slot="composer-overlay"
          className={composeClasses(
            "pointer-events-none absolute inset-0 overflow-hidden text-base wrap-break-word whitespace-pre-wrap text-text-primary sm:text-sm",
            padding,
          )}
        >
          {shown.content}
        </div>
      )}
      <textarea
        data-slot="composer-input"
        {...(overlay === "highlight" && { spellCheck: false })}
        {...suggestionAttributes(context.listbox, activeSuggestion)}
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
        rows={rows ?? (measure && layout === "inline" ? 1 : undefined)}
        className={composeClasses(
          "relative field-sizing-content max-h-48 w-full min-w-0 resize-none bg-transparent text-base placeholder-muted text-text-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-disabled sm:text-sm",
          padding,
          layout === "stacked" && (height ?? "standard") === "standard" && "min-h-24",
          layout === "inline" && !props.value && "field-sizing-fixed placeholder:truncate",
          overlay === "highlight" && "text-transparent caret-text-primary",
        )}
        {...attributes}
      />
    </>
  )
}

function overlayOf(input: {
  overlay: ComposerInputOverlay | undefined
  overlayContent: ReactNode
  mentions: readonly MentionRange[] | undefined
  value: ComposerInputProps["value"]
}): { overlay: ComposerInputOverlay; content: ReactNode } {
  if (input.mentions?.length)
    return {
      overlay: "highlight",
      content: <MentionHighlights text={String(input.value ?? "")} mentions={input.mentions} />,
    }
  return { overlay: input.overlay ?? "none", content: input.overlayContent }
}

function suggestionAttributes(listbox: string | undefined, active: string | undefined) {
  if (!listbox) return {}
  return {
    "aria-autocomplete": "list" as const,
    "aria-controls": listbox,
    ...(active && { "aria-activedescendant": suggestionID(listbox, active) }),
  }
}

const mentionGlyphs: Record<MentionKind, Glyph> = { agent: "Ghost", skill: "Skill", file: "File" }

function MentionHighlights(props: { text: string; mentions: readonly MentionRange[] }) {
  const ordered = props.mentions.toSorted((left, right) => left.start - right.start)
  const pieces = ordered.flatMap((mention, index) => {
    const from = index === 0 ? 0 : (ordered[index - 1]?.end ?? 0)
    return [
      { key: `text-${from}`, text: props.text.slice(from, mention.start) },
      { key: `mention-${mention.start}`, mention },
    ]
  })
  return (
    <span>
      {pieces.map((piece) =>
        "mention" in piece ? (
          <Mention key={piece.key} icon={<Icon glyph={mentionGlyphs[piece.mention.kind]} />}>
            {props.text.slice(piece.mention.start + 1, piece.mention.end - piece.mention.label.length)}
            {piece.mention.label}
          </Mention>
        ) : (
          <Fragment key={piece.key}>{piece.text}</Fragment>
        ),
      )}
      {props.text.slice(ordered.at(-1)?.end ?? 0)}
      {props.text.endsWith("\n") ? "\u200b" : null}
    </span>
  )
}

export type MentionProps = { icon?: ReactNode; children: ReactNode }

export function Mention(props: MentionProps) {
  return (
    <span
      data-slot="composer-mention"
      className="rounded-control bg-fill-inverse/tint [box-decoration-break:clone] font-medium text-text-primary ring-2 ring-border-strong/tint"
    >
      <span className="relative text-transparent">
        @
        {props.icon ? (
          <span className="absolute top-1/2 left-px inline-grid size-4 -translate-y-1/2 place-items-center overflow-hidden rounded-control text-text-primary [&_img]:size-4 [&_img]:object-contain [&_svg]:size-4">
            {props.icon}
          </span>
        ) : null}
      </span>
      {props.children}
    </span>
  )
}

const suggestionID = (listbox: string, value: string) => `${listbox}-${encodeURIComponent(value)}`

export type SuggestionKind = MentionKind | "command"

export type Suggestion = { value: string; kind: SuggestionKind; label: string; description?: string | undefined }

export type SuggestionsProps = {
  label: string
  items: readonly Suggestion[]
  active: string | undefined
  onActiveChange: (value: string) => void
  onSelect: (value: string) => void
}

const suggestionGroups: Record<SuggestionKind, string> = {
  agent: "Agents",
  skill: "Skills",
  file: "Files",
  command: "Commands",
}

const suggestionGlyphs: Partial<Record<SuggestionKind, Glyph>> = mentionGlyphs

export function Suggestions(props: SuggestionsProps) {
  const listbox = use(ComposerLayoutContext).listbox
  const list = useRef<HTMLDivElement>(null)
  const starts = props.items.flatMap((item, index) =>
    index === 0 || props.items[index - 1]?.kind !== item.kind ? [index] : [],
  )
  const groups = starts.map((start, index) => props.items.slice(start, starts[index + 1]))
  useLayoutEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" })
  }, [props.active])
  return (
    <Surface.Overlay
      id={listbox}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- the text field keeps focus and points into the options, which a <select> cannot do
      role="listbox"
      aria-label={props.label}
      padding="small"
      overflow="scrolling"
      height="limited"
    >
      <div ref={list} className="flex flex-col">
        {groups.map((group) => (
          <SuggestionGroup key={group.at(0)?.value} kind={group.at(0)?.kind ?? "command"}>
            {group.map((item) => (
              <SuggestionOption
                key={item.value}
                id={listbox ? suggestionID(listbox, item.value) : undefined}
                item={item}
                active={item.value === props.active}
                onActiveChange={props.onActiveChange}
                onSelect={props.onSelect}
              />
            ))}
          </SuggestionGroup>
        ))}
      </div>
    </Surface.Overlay>
  )
}

function SuggestionGroup(props: { kind: SuggestionKind; children: ReactNode }) {
  return (
    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- options inside a listbox group through role="group"; an <optgroup> needs a <select>
    <div role="group" aria-label={suggestionGroups[props.kind]} className="flex min-w-0 flex-col gap-1">
      <span
        aria-hidden="true"
        className="truncate px-2 pt-2 text-2xs font-reading-semibold text-text-secondary uppercase"
      >
        {suggestionGroups[props.kind]}
      </span>
      {props.children}
    </div>
  )
}

function SuggestionOption(props: {
  id: string | undefined
  item: Suggestion
  active: boolean
  onActiveChange: (value: string) => void
  onSelect: (value: string) => void
}) {
  const glyph = suggestionGlyphs[props.item.kind]
  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus -- the text field keeps focus and drives the options through aria-activedescendant
    <div
      id={props.id}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an <option> lives only inside a <select>, which cannot keep the text field focused
      role="option"
      aria-selected={props.active}
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={() => {
        if (!props.active) props.onActiveChange(props.item.value)
      }}
      onClick={() => props.onSelect(props.item.value)}
      className={composeClasses(itemVariants({ density: "compact", interactive: true, selected: props.active }))}
    >
      {glyph ? (
        <span className={leadingSlot}>
          <Icon glyph={glyph} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <Text purpose="body" element="span" truncation="single-line">
          {props.item.label}
        </Text>
        {props.item.description ? (
          <Text purpose="body" tone="secondary" element="span" truncation="single-line">
            {props.item.description}
          </Text>
        ) : null}
      </span>
    </div>
  )
}

export type ComposerSubmitProps = {
  running: boolean
  content: boolean
  disabled?: boolean
  starting?: boolean
  onStop: () => void
}

export function ComposerSubmit(props: ComposerSubmitProps) {
  if (props.starting)
    return (
      <IconButton type="submit" appearance="secondary" shape="circle" size="medium" pending label="Starting session">
        <Icon glyph="ArrowUp" />
      </IconButton>
    )
  const stop = (appearance: "primary" | "secondary") => (
    <IconButton
      appearance={appearance}
      shape="circle"
      size="medium"
      label="Stop"
      onClick={(event) => {
        event.preventDefault()
        props.onStop()
      }}
    >
      <Icon glyph="Stop" />
    </IconButton>
  )
  if (props.running && !props.content) return stop("primary")
  const send = (
    <IconButton
      type="submit"
      appearance={props.content ? "primary" : "secondary"}
      shape="circle"
      size="medium"
      label="Send"
      disabled={props.disabled}
    >
      <Icon glyph="ArrowUp" />
    </IconButton>
  )
  if (!props.running) return send
  return (
    <div className="flex items-center gap-2">
      {stop("secondary")}
      {send}
    </div>
  )
}

export type ComposerAlternateProps = {
  label: string
  shortcut: string
  description?: string
  onActivate: () => void
}

export function ComposerAlternate(props: ComposerAlternateProps) {
  return (
    <Button appearance="ghost" size="small" title={props.description} onClick={props.onActivate}>
      {props.label}
      <KeyboardKey>{props.shortcut}</KeyboardKey>
    </Button>
  )
}

export type QueueProps = {
  label: string
  count: number
  onReorder?: ((from: number, to: number) => void) | undefined
  children: ReactNode
}

type QueueDrag = { id: string; order: readonly string[]; from: number; to: number }

type QueuePointer = {
  id: string
  pointer: number
  origin: number
  scroll: number
  order: readonly string[]
  from: number
  middles: readonly number[]
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

const moved = (order: readonly string[], from: number, to: number) => {
  const item = order[from]
  if (item === undefined) return order
  const rest = order.filter((_, index) => index !== from)
  return [...rest.slice(0, to), item, ...rest.slice(to)]
}

export function Queue(props: QueueProps) {
  const list = useRef<HTMLUListElement>(null)
  const pointer = useRef<QueuePointer | undefined>(undefined)
  const [drag, setDrag] = useState<QueueDrag>()
  const onReorder = props.onReorder
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
    const y = event.clientY + node.scrollTop - current.scroll
    const to = current.middles.filter((middle, index) => index !== current.from && middle < y).length
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
    const y = event.clientY + node.scrollTop - current.scroll
    const to = current.middles.filter((middle, index) => index !== current.from && middle < y).length
    if (to !== current.from) onReorder?.(current.from, to)
  }
  return (
    <QueueContext value={{ drag, start: onReorder ? start : undefined, move, end }}>
      <section
        aria-label={props.label}
        data-slot="composer-queue"
        className="flex min-w-0 flex-col rounded-t-container border border-b-0 border-border-primary bg-background-secondary pb-6"
      >
        {props.count > 3 ? (
          <div className="px-3 pt-2">
            <Text purpose="caption" tone="secondary" element="span">
              {props.label}
            </Text>
          </div>
        ) : null}
        <ul
          ref={list}
          className={composeClasses(
            "flex min-w-0 flex-col py-1",
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
    <Menu.Root>
      <Menu.Trigger
        render={
          <IconButton label="Reorder" size="compact" disabled={props.busy}>
            <Icon glyph="SortArrows" />
          </IconButton>
        }
      />
      <Menu.Popup placement="top" alignment="end">
        <Menu.Item
          icon={<Icon glyph="ArrowUp" />}
          disabled={!props.onMoveUp}
          {...(props.onMoveUp && { onSelect: props.onMoveUp })}
        >
          Move up
        </Menu.Item>
        <Menu.Item
          icon={<Icon glyph="ArrowDown" />}
          disabled={!props.onMoveDown}
          {...(props.onMoveDown && { onSelect: props.onMoveDown })}
        >
          Move down
        </Menu.Item>
      </Menu.Popup>
    </Menu.Root>
  )
}

function QueueHandle(props: { id: string; busy: boolean }) {
  const queue = use(QueueContext)
  return (
    <span
      aria-hidden="true"
      data-slot="composer-queue-handle"
      onPointerDown={(event) => {
        if (!props.busy) queue.start?.(props.id, event)
      }}
      onPointerMove={queue.move}
      onPointerUp={(event) => queue.end(event, { drop: true })}
      onPointerCancel={(event) => queue.end(event, { drop: false })}
      className="-ml-1 flex shrink-0 cursor-grab touch-none items-center text-text-secondary active:cursor-grabbing"
    >
      <Icon glyph="GripVertical" />
    </span>
  )
}

function QueueActions(props: QueueItemProps) {
  const visible = props.actions === "visible"
  return (
    <span
      className={composeClasses(
        "flex shrink-0 items-center gap-1 transition-standard",
        visible
          ? "opacity-100"
          : "opacity-0 group-focus-within/queue:opacity-100 group-hover/queue:opacity-100 has-data-popup-open:opacity-100 [@media(hover:none)]:opacity-100",
        props.busy && "pointer-events-none",
      )}
    >
      {props.onSend ? (
        <IconButton label={props.sendLabel ?? "Send now"} size="compact" disabled={props.busy} onClick={props.onSend}>
          <Icon glyph="ArrowUp" />
        </IconButton>
      ) : null}
      {props.onMove ? (
        <IconButton label="Move to composer" size="compact" disabled={props.busy} onClick={props.onMove}>
          <Icon glyph="Restore" />
        </IconButton>
      ) : null}
      {props.onMoveUp || props.onMoveDown ? (
        <QueueReorder busy={props.busy === true} onMoveUp={props.onMoveUp} onMoveDown={props.onMoveDown} />
      ) : null}
      {props.onRemove ? (
        <IconButton label="Remove" size="compact" disabled={props.busy} onClick={props.onRemove}>
          <Icon glyph="X" />
        </IconButton>
      ) : null}
    </span>
  )
}

export function QueueItem(props: QueueItemProps) {
  const id = useId()
  const queue = use(QueueContext)
  const drag = queue.drag
  const position = drag ? moved(drag.order, drag.from, drag.to).indexOf(id) : -1
  const dragging = drag?.id === id
  return (
    <li
      data-slot="composer-queue-item"
      data-queue-item={id}
      data-dragging={dragging ? "" : undefined}
      style={position < 0 ? undefined : { order: position }}
      className="group/queue flex min-h-8 min-w-0 items-center gap-2 px-3 data-dragging:opacity-disabled"
    >
      {queue.start ? <QueueHandle id={id} busy={props.busy === true} /> : null}
      <span className="min-w-0 flex-1">
        <Text purpose="body" truncation="single-line" element="span">
          {props.text}
        </Text>
      </span>
      {props.detail ? (
        <Text purpose="caption" tone="secondary" element="span">
          {props.detail}
        </Text>
      ) : null}
      <QueueActions {...props} />
    </li>
  )
}

const characters = new Intl.NumberFormat()

export type PastedTextProps = {
  text: string
  disabled?: boolean
  onRemove: () => void
  onShowInTextField: () => void
}

export function PastedText(props: PastedTextProps) {
  return (
    <AttachmentTile.Excerpt
      name="Pasted text"
      removeLabel="Remove pasted text"
      {...(props.disabled ? {} : { onRemove: props.onRemove })}
      footer={
        <>
          <Text purpose="caption" element="span">
            {characters.format(props.text.length)} characters
          </Text>
          <Button appearance="link" disabled={props.disabled} onClick={props.onShowInTextField}>
            Show in text field
          </Button>
        </>
      }
    >
      <Text purpose="caption" truncation="three-lines">
        {props.text.slice(0, 300)}
      </Text>
    </AttachmentTile.Excerpt>
  )
}

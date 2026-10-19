export * as ConversationShell from "./conversation-shell.js"

import { cva } from "class-variance-authority"
import { createContext, use, useLayoutEffect, useRef } from "react"
import type { ComponentPropsWithoutRef, KeyboardEvent, ReactNode, Ref, UIEvent } from "react"
import { composeClasses } from "../lib/compose-classes.js"
import { Icon } from "./icon.js"
import { Text } from "./text.js"

export type Mode = "live" | "pending" | "read-only" | "replay"
export type ComposerPosition = "docked" | "centered"
export type Scrollbar = "visible" | "hidden"

export type RootProps = {
  mode?: Mode
  header?: ReactNode
  transcript?: ReactNode
  populated: boolean
  placeholder?: ReactNode
  interaction?: ReactNode
  composer?: ReactNode
  composerPosition?: ComposerPosition
  composerRef?: Ref<HTMLDivElement>
  composerHeight?: number
  auxiliary?: ReactNode
  overlay?: ReactNode
  hidden?: boolean
  viewportRef?: Ref<HTMLDivElement>
  contentRef?: Ref<HTMLDivElement>
  endRef?: Ref<HTMLDivElement>
  onViewportScroll?: (event: UIEvent<HTMLDivElement>) => void
  scrollbar?: Scrollbar
  latest?: { visible: boolean; onActivate: () => void }
}

export function Root(props: RootProps) {
  const hidden = props.hidden ?? false
  const position = props.composerPosition ?? "docked"
  return (
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
          {position === "docked" ? <Transcript {...props} /> : null}
          <Dock
            position={position}
            container={props.composerRef}
            interaction={props.interaction}
            composer={props.composer}
          />
        </div>
        {props.overlay ? <div className="absolute inset-0 flex min-h-0 flex-col">{props.overlay}</div> : null}
      </div>
      <Auxiliary>{props.auxiliary}</Auxiliary>
    </div>
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

function Transcript(props: RootProps) {
  return (
    <>
      <Viewport
        populated={props.populated}
        scrollbar={props.scrollbar}
        composerHeight={props.composerHeight}
        viewport={props.viewportRef}
        content={props.contentRef}
        end={props.endRef}
        onScroll={props.onViewportScroll}
      >
        {props.transcript}
      </Viewport>
      {props.latest ? <JumpToLatest {...props.latest} composerHeight={props.composerHeight} /> : null}
    </>
  )
}

function Dock({
  position,
  container,
  interaction,
  composer,
}: {
  position: ComposerPosition
  container: Ref<HTMLDivElement> | undefined
  interaction: ReactNode
  composer: ReactNode
}) {
  if (!interaction && !composer) return null
  if (position === "centered") {
    return (
      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-2 md:px-4">
        <div
          ref={container}
          className="flex w-full max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] flex-col gap-2"
        >
          {interaction}
          {composer}
        </div>
      </div>
    )
  }
  return (
    <div
      ref={container}
      data-slot="composer-dock"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex w-full flex-col items-center gap-2 bg-linear-to-t from-background-primary from-30% via-background-primary/disabled to-transparent px-4 pt-8 pb-3 *:pointer-events-auto *:w-full *:max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] md:px-6 md:pb-4"
    >
      {interaction}
      {composer}
    </div>
  )
}

function Viewport({
  populated,
  scrollbar,
  composerHeight,
  viewport,
  content,
  end,
  onScroll,
  children,
}: {
  populated: boolean
  scrollbar: Scrollbar | undefined
  composerHeight: number | undefined
  viewport: Ref<HTMLDivElement> | undefined
  content: Ref<HTMLDivElement> | undefined
  end: Ref<HTMLDivElement> | undefined
  onScroll: ((event: UIEvent<HTMLDivElement>) => void) | undefined
  children: ReactNode
}) {
  return (
    <div
      ref={viewport}
      data-slot="transcript-viewport"
      onScroll={onScroll}
      className={composeClasses(
        "absolute inset-0 touch-pan-y scrollbar-gutter-both overflow-y-auto overscroll-contain",
        populated ? "bg-background-primary" : "bg-transparent",
        scrollbar === "hidden" && "scrollbar-none",
      )}
    >
      <div
        ref={content}
        className="mx-auto flex min-h-full max-w-[calc(var(--ren-container-content)-var(--ren-spacing-8))] min-w-0 flex-col gap-4 px-4 pt-12 pb-6 md:gap-6 md:px-6"
      >
        {children}
        <div
          ref={end}
          className="min-h-6 min-w-6 shrink-0"
          style={composerHeight ? { minHeight: composerHeight + 8 } : undefined}
        />
      </div>
    </div>
  )
}

function JumpToLatest(props: { visible: boolean; onActivate: () => void; composerHeight?: number | undefined }) {
  return (
    <button
      type="button"
      aria-label="Scroll to bottom"
      onClick={props.onActivate}
      style={props.composerHeight ? { bottom: props.composerHeight - 20 } : undefined}
      className={composeClasses(
        "absolute bottom-4 left-1/2 z-20 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border-primary/disabled bg-background-secondary text-text-secondary shadow-overlay transition-standard hover:text-text-primary active:scale-95 [&_svg]:size-4",
        props.visible ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none scale-90 opacity-0",
      )}
    >
      <Icon glyph="ArrowDown" />
    </button>
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

export type ComposerLayout = "stacked" | "inline"

const ComposerLayoutContext = createContext<ComposerLayout>("stacked")

const composerLayoutClasses: Record<ComposerLayout, { form: string; input: string; status: string }> = {
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

export function Composer(props: ComposerProps) {
  const layout = props.layout ?? "stacked"
  const inline = layout === "inline"
  const classes = composerLayoutClasses[layout]
  return (
    <ComposerLayoutContext value={layout}>
      <div className="relative flex w-full min-w-0 flex-col gap-2">
        {props.suggestions ? <div className="absolute inset-x-0 bottom-full z-50 mb-6">{props.suggestions}</div> : null}
        {props.header ? <div className="flex min-w-0 items-center px-1">{props.header}</div> : null}
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
            {props.status ? (
              <div className={composeClasses("absolute z-10", classes.status)}>{props.status}</div>
            ) : null}
          </div>
          {inline && props.trailing ? (
            <div className="flex min-w-0 items-center gap-2 self-end pr-2 pb-2">{props.trailing}</div>
          ) : null}
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
      </div>
    </ComposerLayoutContext>
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
  const form = event.currentTarget.form
  if (form?.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled) return
  form?.requestSubmit()
}

export type ComposerInputHeight = "content" | "standard"
export type ComposerInputOverlay = "none" | "highlight" | "preview"

const composerInputPadding: Record<ComposerLayout, string> = {
  inline: "px-2 py-3",
  stacked: "px-4 pt-4 pb-2",
}

export type ComposerInputProps = {
  height?: ComposerInputHeight
  overlay?: ComposerInputOverlay
  overlayContent?: ReactNode
  ref?: Ref<HTMLTextAreaElement>
} & Omit<ComponentPropsWithoutRef<"textarea">, "className" | "style">

export function ComposerInput(props: ComposerInputProps) {
  const { height, overlay: overlayProp, overlayContent, ref, onScroll, onKeyDown, ...attributes } = props
  const layout = use(ComposerLayoutContext)
  const input = useRef<HTMLTextAreaElement | null>(null)
  const layer = useRef<HTMLDivElement>(null)
  const overlay = overlayProp ?? "none"
  const synchronize = () => {
    if (!input.current || !layer.current) return
    layer.current.scrollTop = input.current.scrollTop
    layer.current.scrollLeft = input.current.scrollLeft
  }
  useLayoutEffect(synchronize, [props.value, overlay])
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
          {overlayContent}
        </div>
      )}
      <textarea
        data-slot="composer-input"
        ref={(node) => {
          input.current = node
          if (typeof ref === "function") return ref(node)
          if (ref) ref.current = node
        }}
        onScroll={(event) => {
          synchronize()
          onScroll?.(event)
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          submitOnEnter(event)
        }}
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

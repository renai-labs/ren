import { DateTime } from "effect"
import { flushSync } from "react-dom"
import {
  startTransition,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  type TouchEvent,
  type UIEvent,
  type WheelEvent,
} from "react"
import {
  Activity,
  ChannelReply,
  ChatState,
  Projection,
  TimelineDetail,
  TimelineRow,
  TimelineText,
  type ChatAtoms,
} from "@ren/chat"
import { cn } from "cn"
import { AppConnectCard } from "./app-connect.js"
import { Channel } from "@ren/schema/channel"
import { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import { Bubble, BubbleContent } from "@ren/ui/bubble"
import { Button } from "@ren/ui/button"
import { Kbd, KbdGroup } from "@ren/ui/kbd"
import { FindBar, type FindBarProps } from "@ren/ui/find-bar"
import { Marker, MarkerContent, MarkerIcon } from "@ren/ui/marker"
import { Message, MessageContent, MessageFooter } from "@ren/ui/message"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from "@ren/ui/message-scroller"
import { Spinner } from "@ren/ui/spinner"
import { FileOutputs } from "./file-outputs.js"
import { QuoteSelection, type QuoteProps } from "./quote.js"
import { Markdown } from "../../components/markdown.js"
import { MarkdownScroll } from "../../components/markdown-link.js"
import { ImageSet } from "../../components/image-set.js"
import { TurnProblem, TurnRetrying } from "./turn-problem.js"
import { providerLabel, type ProblemHandlers } from "./turn-problems.js"
import { MessagesSpinner } from "../../components/chat-skeleton.js"
import { LiveActivity, type LiveLine } from "./live-activity.js"
import { useOpenActivity } from "./open-panel.js"
import { EmptyState } from "../../components/empty-state.js"
import { ChannelMark } from "../../components/channel-mark.js"
import { useMentionedApps } from "../../lib/use-app.js"
import { SmoothMarkdown, StepRuns, Steps, StepsProvider } from "./steps.js"
import { TranscriptBlocks } from "./transcript-blocks.js"
import { revealOnHover } from "./message-actions.js"
import { useTerminalShells } from "./terminal-shells.js"
import { CopyButton, UserMessage, type Person } from "./user-message.js"

export interface TranscriptHandle {
  readonly page: (direction: -1 | 1) => void
  readonly toEnd: () => void
}

export interface TranscriptProps {
  readonly handle?: Ref<TranscriptHandle> | undefined
  readonly files?: boolean | undefined
  readonly quote?: QuoteProps | undefined
  readonly view: ChatAtoms.View
  readonly spaceId?: string | undefined
  readonly messages: ReadonlyArray<SessionMessage.Info>
  readonly rows: ReadonlyArray<TimelineRow.Row>
  readonly activeMessageID: string | undefined
  readonly busy: boolean
  readonly working: boolean
  readonly starting?: boolean | undefined
  readonly asking?: boolean | undefined
  readonly simple?: boolean | undefined
  readonly waiting?: boolean | undefined
  readonly statuses: ReadonlyMap<string, ChatState.PendingStatus>
  readonly viewer: Person & { readonly id: string }
  readonly people: ReadonlyMap<string, Person>
  readonly more: boolean
  readonly loading?: boolean | undefined
  readonly loadingHistory: boolean
  readonly onLoadMore: () => void
  readonly find?: FindBarProps | undefined
  readonly onOpenChild: (sessionID: Session.ID) => void
  readonly onEdit?: ((message: SessionMessage.User, text: string) => void) | undefined
  readonly onRetry?: ((id: SessionMessage.ID) => void) | undefined
  readonly onRemove?: ((id: SessionMessage.ID) => void) | undefined
  readonly fold: boolean
  readonly detail: TimelineDetail.Detail
  readonly foldMessages?: boolean | undefined
  readonly modelNames?: ReadonlyMap<string, string> | undefined
  readonly empty?: string | undefined
  readonly admin?: boolean | undefined
  readonly onTryAgain?: ((text: string) => void) | undefined
  readonly onContinue?: (() => void) | undefined
  readonly onConnected?: ((app: string) => void) | undefined
  readonly onChangeModel?: (() => void) | undefined
  readonly onStop?: (() => void) | undefined
  readonly background?: { readonly blocking: boolean; readonly onMove: () => void } | undefined
}

function ChannelReplyMessage(props: { tool: SessionMessage.Tool }) {
  const reply = ChannelReply.of(props.tool)
  return (
    <Message>
      <MessageContent>
        <Marker className="text-xs">
          {reply.sent ? (
            <MarkerIcon>
              <ChannelMark provider={reply.sent.provider} className="size-4" />
            </MarkerIcon>
          ) : null}
          <MarkerContent>
            {reply.sent ? `Sent on ${Channel.titles[reply.sent.provider]}` : "Sending to the thread…"}
          </MarkerContent>
        </Marker>
        <Bubble variant="ghost">
          <BubbleContent className="text-base leading-[1.7]">
            <Markdown className="text-base leading-[1.7]">{reply.text}</Markdown>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function ErrorRow(props: { row: Extract<TimelineRow.Row, { _tag: "Error" }>; context: Context }) {
  const row = props.row
  const assistants = props.context.turns.get(row.userMessageID) ?? []
  const last = assistants.at(-1)
  return (
    <TurnProblem
      kind={row.kind}
      text={row.text}
      provider={providerLabel(last?.model.providerID ?? "the model provider")}
      model={last ? (props.context.modelNames.get(last.model.id) ?? last.model.id) : "This model"}
      midTurn={assistants.some((message) => message.content.some((content) => content.type === "tool"))}
      admin={props.context.admin}
      handlers={props.context.handlers(row.userMessageID)}
    />
  )
}

function RetryRow(props: { row: Extract<TimelineRow.Row, { _tag: "Retry" }>; context: Context }) {
  const row = props.row
  if (props.context.activeMessageID !== row.userMessageID) return null
  const last = (props.context.turns.get(row.userMessageID) ?? []).at(-1)
  const retry = last?.retry
  if (!last || !retry) return null
  return (
    <TurnRetrying
      kind={retry.error.type}
      text={retry.error.message}
      provider={providerLabel(last.model.providerID)}
      at={DateTime.toEpochMillis(retry.at)}
      attempt={retry.attempt}
      handlers={props.context.handlers(row.userMessageID)}
    />
  )
}

function Separator(props: { children: ReactNode }) {
  return (
    <Marker variant="separator">
      <MarkerContent>{props.children}</MarkerContent>
    </Marker>
  )
}

function ModelSwitched(props: { message: Extract<SessionMessage.Info, { type: "model-switched" }>; context: Context }) {
  const model = props.message.model
  const variant = model.variant && model.variant !== "default" ? model.variant : undefined
  return (
    <Separator>
      {props.context.modelNames.get(model.id) ?? model.id}
      {variant ? ` · ${variant.charAt(0).toUpperCase()}${variant.slice(1)}` : null}
    </Separator>
  )
}

function NoticeRow(props: { messageID: string; context: Context }) {
  const message = props.context.byId.get(props.messageID)
  if (!message) return null
  if (message.type === "compaction") return <Separator>{TimelineText.compaction(message)}</Separator>
  if (message.type === "model-switched") return <ModelSwitched message={message} context={props.context} />
  const notice = TimelineText.notice(message)
  if (!notice) return null
  return (
    <Marker variant="default">
      <MarkerContent>{notice.detail ? `${notice.title} · ${notice.detail}` : notice.title}</MarkerContent>
    </Marker>
  )
}

function SystemRow(props: { row: TimelineRow.Row; context: Context }) {
  const row = props.row
  if (row._tag === "Error") return <ErrorRow row={row} context={props.context} />
  if (row._tag === "Retry") return <RetryRow row={row} context={props.context} />
  if (row._tag === "TurnDivider") return <Separator>Interrupted</Separator>
  if (row._tag === "CompactionQueued") return <Separator>Session compaction queued</Separator>
  if (row._tag !== "Notice") return null
  return <NoticeRow messageID={row.messageID} context={props.context} />
}

function LoadEarlier(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver((entries) => {
          if (node.closest("[data-pending-scroll]")) return
          if (entries.some((entry) => entry.isIntersecting)) props.onVisible()
        })
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

interface Context {
  readonly admin: boolean
  readonly handlers: (userMessageID: string) => ProblemHandlers
  readonly modelNames: ReadonlyMap<string, string>
  readonly byId: ReadonlyMap<string, SessionMessage.Info>
  readonly turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  readonly activeMessageID: string | undefined
}

function UserBlock(props: {
  message: SessionMessage.User
  rowKey: string
  transcript: TranscriptProps
  editing: boolean
  onEditing: (id: string | undefined) => void
}) {
  const transcript = props.transcript
  const message = props.message
  const status = transcript.statuses.get(message.id)
  const senderId = message.sender?.userId
  const person =
    senderId && senderId !== transcript.viewer.id
      ? (transcript.people.get(senderId) ?? { name: "Member", image: undefined })
      : transcript.viewer
  const edit = transcript.onEdit
  return (
    <UserMessage
      message={message}
      spaceId={transcript.spaceId}
      fold={transcript.foldMessages === true}
      reveal={transcript.find?.match?.row === props.rowKey}
      person={person}
      status={status}
      editing={props.editing}
      onEdit={edit && (status === undefined || status === "queued") ? () => props.onEditing(message.id) : undefined}
      onRetry={transcript.onRetry && (() => transcript.onRetry?.(message.id))}
      onRemove={transcript.onRemove && (() => transcript.onRemove?.(message.id))}
      onCancel={() => props.onEditing(undefined)}
      onSave={(text) => {
        props.onEditing(undefined)
        edit?.(message, text)
      }}
    />
  )
}

function AnswerBlock(props: {
  text: string
  streaming: boolean
  copy: string | undefined
  root: Session.ID
  files: boolean
  messages: ReadonlyArray<SessionMessage.Info>
}) {
  const apps = useMentionedApps(props.text)
  const images = new Map(
    props.messages.flatMap((message) =>
      message.type !== "assistant"
        ? []
        : message.content.flatMap((part) => {
            if (part.type !== "tool" || part.state.status !== "completed") return []
            const input = part.state.input
            return part.state.content.flatMap((content) => {
              if (content.type !== "file" || !content.uri.startsWith("data:image/")) return []
              const source = content.name ?? (part.name === "read" ? (input.path ?? input.filePath) : undefined)
              if (typeof source !== "string") return []
              const path = source.replace(/^.*\/(?=\.ren\/images\/)/u, "").replace(/^\.\//u, "")
              return [[path, content.uri] as const]
            })
          }),
    ),
  )
  return (
    <Message>
      <MessageContent>
        <Bubble variant="ghost">
          <BubbleContent data-searchable="" data-quotable="Ren's reply" className="text-base leading-[1.7]">
            <SmoothMarkdown
              text={props.text}
              root={props.root}
              files={props.files}
              images={images}
              streaming={props.streaming}
              apps={apps}
              className="text-base leading-[1.7]"
            />
          </BubbleContent>
        </Bubble>
        {props.copy === undefined ? null : (
          <MessageFooter
            aria-hidden={props.copy === "" || undefined}
            inert={props.copy === ""}
            className={cn(revealOnHover, props.copy === "" && "invisible")}
          >
            <CopyButton text={props.copy} />
          </MessageFooter>
        )}
      </MessageContent>
    </Message>
  )
}

// oxlint-disable-next-line ren/no-comments -- In the one-line timeline a turn's "Worked for" opens that turn in Activity when the person chose the side panel. Otherwise it expands in place.
function TurnSteps(props: {
  block: Extract<TranscriptBlocks.Block, { kind: "steps" }>
  folded: boolean
  simple: boolean
  workedFor: string | undefined
}) {
  const openPanel = useOpenActivity()
  const turn = props.block.turn
  return (
    <Message>
      <MessageContent>
        {props.folded ? (
          <Steps
            steps={props.block.steps}
            workedFor={props.workedFor}
            onOpen={props.simple && openPanel ? () => openPanel({ kind: "activity", turn }) : undefined}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <StepRuns steps={props.block.steps} />
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

function BlockView(props: {
  block: TranscriptBlocks.Block
  transcript: TranscriptProps
  context: Context
  editing: string | undefined
  onEditing: (id: string | undefined) => void
  copyOf: (turn: string, key: string) => string | undefined
  workedFor: (turn: string) => string | undefined
}) {
  const block = props.block
  if (block.kind === "user")
    return (
      <UserBlock
        message={block.message}
        rowKey={block.key}
        transcript={props.transcript}
        editing={props.editing === block.message.id}
        onEditing={props.onEditing}
      />
    )
  if (block.kind === "steps")
    return (
      <TurnSteps
        block={block}
        folded={props.transcript.fold}
        simple={props.transcript.simple === true}
        workedFor={props.workedFor(block.turn)}
      />
    )
  if (block.kind === "answer")
    return (
      <AnswerBlock
        root={props.transcript.view.root}
        files={props.transcript.files === true}
        messages={props.transcript.messages}
        text={block.text}
        streaming={block.streaming}
        copy={props.copyOf(block.turn, block.key)}
      />
    )
  if (block.kind === "reply") return <ChannelReplyMessage tool={block.tool} />
  if (block.kind === "empty")
    return (
      <Message>
        <MessageContent>
          <Marker variant="default">
            <MarkerContent>Ren sent an empty response.</MarkerContent>
          </Marker>
        </MessageContent>
      </Message>
    )
  if (block.kind === "connect")
    return (
      <Message>
        <MessageContent>
          {block.connects.map((connect) => (
            <AppConnectCard
              key={`${connect.appId}:${connect.spaceId}`}
              appId={connect.appId}
              spaceId={connect.spaceId}
              onConnected={props.transcript.onConnected}
            />
          ))}
        </MessageContent>
      </Message>
    )
  if (block.kind === "file")
    return (
      <Message>
        <MessageContent>
          <FileOutputs spaceId={props.transcript.spaceId} files={[block.file]} />
        </MessageContent>
      </Message>
    )
  return <SystemRow row={block.row} context={props.context} />
}

function History(props: { loading: boolean; onLoadMore: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-6 items-center justify-center text-xs text-muted-foreground">
      {props.loading ? (
        <output className="flex animate-in items-center gap-2 delay-300 duration-200 fade-in-0 fill-mode-backwards motion-reduce:animate-none">
          <Spinner />
          Loading earlier messages
        </output>
      ) : (
        <LoadEarlier onVisible={props.onLoadMore} />
      )}
    </div>
  )
}

const markerOf = (props: TranscriptProps, live: { readonly busy: boolean }) => {
  if (props.starting) return { label: "Starting your computer", labelled: true }
  if (!live.busy && !props.working) return props.waiting ? { label: "Working on the next step", labelled: true } : null
  return { label: "Working on the next step", labelled: props.working || props.background?.blocking === true }
}

type LiveSlot = { readonly kind: "live"; readonly key: string; readonly turn: string }

// oxlint-disable-next-line ren/no-comments -- Files a turn shows one after another render as one group, in one row.
type FilesGroup = {
  readonly kind: "files"
  readonly key: string
  readonly files: ReadonlyArray<SessionMessage.DriveFile>
}

const groupFiles = (blocks: ReadonlyArray<TranscriptBlocks.Block | LiveSlot>) =>
  blocks.reduce<Array<TranscriptBlocks.Block | LiveSlot | FilesGroup>>((grouped, block) => {
    const last = grouped.at(-1)
    if (block.kind !== "file") grouped.push(block)
    else if (last?.kind === "files") grouped[grouped.length - 1] = { ...last, files: [...last.files, block.file] }
    else grouped.push({ kind: "files", key: block.key, files: [block.file] })
    return grouped
  }, [])

// oxlint-disable-next-line ren/no-comments -- With the live line, a running turn's text streams in place and its steps wait in Activity. The line takes the place of the turn's first step, or sits right below its message before it has one, which is where its "Worked for" line lands, so it turns into that line in place when the turn ends and never follows the answer. An answer with nothing done before it has no line.
const shownBlocks = (
  blocks: ReadonlyArray<TranscriptBlocks.Block>,
  live: { readonly simple: boolean; readonly turn: string | undefined; readonly line: boolean },
): ReadonlyArray<TranscriptBlocks.Block | LiveSlot> => {
  const turn = live.turn
  if (!live.simple || !turn || !live.line) return blocks
  const step = blocks.findIndex((block) => block.kind === "steps" && block.turn === turn)
  const at = step === -1 ? blocks.findIndex((block) => block.kind === "user" && block.message.id === turn) + 1 : step
  if (at === 0) return blocks
  const slot: LiveSlot = { kind: "live", key: `live:${turn}`, turn }
  return [...blocks.slice(0, at), slot, ...blocks.slice(at)].filter(
    (block) => !(block.kind === "steps" && block.turn === turn),
  )
}

// oxlint-disable-next-line ren/no-comments -- The turn whose slot shows the live line: the one that runs or, while the computer starts or a message waits for it, the newest message, which Ren has not taken yet.
const liveOf = (
  props: TranscriptProps,
  blocks: ReadonlyArray<TranscriptBlocks.Block>,
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>,
) => {
  const waiting = props.starting === true || props.waiting === true
  const newest = blocks.findLast((block) => block.kind === "user")
  const pending = waiting && newest?.kind === "user" ? newest.message.id : undefined
  return { turn: props.busy ? props.activeMessageID : pending, line: liveLine(props, turns) !== undefined }
}

const liveLine = (
  props: TranscriptProps,
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>,
): LiveLine | undefined => {
  if (props.starting) return { text: "Starting your computer", kind: "starting" }
  if (props.asking) return { text: "Waiting for your answer", kind: "waiting" }
  return Activity.current(turns.get(props.activeMessageID ?? "") ?? [])
}

function TurnLine(props: {
  transcript: TranscriptProps
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
}) {
  const openPanel = useOpenActivity()
  const transcript = props.transcript
  const turn = transcript.activeMessageID
  const line = liveLine(transcript, props.turns)
  if (!line) return null
  return (
    <LiveActivity line={line} onOpen={openPanel && turn ? () => openPanel({ kind: "activity", turn }) : undefined} />
  )
}

// oxlint-disable-next-line ren/no-comments -- Only the room of the live line at the end, never the line: the activity of a turn never follows its output, so the line shows only in its slot below the message. The room keeps the end still when a turn starts or ends.
function LiveMarker(props: {
  transcript: TranscriptProps
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  busy: boolean
}) {
  const transcript = props.transcript
  if (!markerOf(transcript, { busy: props.busy })) return null
  return (
    // ast-grep-ignore: require-message-scroller-parts -- rendered only inside the transcript's MessageScrollerContent
    <MessageScrollerItem messageId="working" aria-hidden className="invisible">
      <Message>
        <MessageContent>
          <TurnLine transcript={transcript} turns={props.turns} />
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  )
}

function TurnMarker(props: {
  simple: boolean
  transcript: TranscriptProps
  turns: ReadonlyMap<string, ReadonlyArray<SessionMessage.Assistant>>
  busy: boolean
}) {
  if (props.simple) return <LiveMarker transcript={props.transcript} turns={props.turns} busy={props.busy} />
  return (
    <WorkingMarker marker={markerOf(props.transcript, { busy: props.busy })} background={props.transcript.background} />
  )
}

function WorkingMarker(props: { marker: ReturnType<typeof markerOf>; background: TranscriptProps["background"] }) {
  if (!props.marker) return null
  const labelled = props.marker.labelled
  const label = props.marker.label
  return (
    // ast-grep-ignore: require-message-scroller-parts -- rendered only inside the transcript's MessageScrollerContent
    <MessageScrollerItem messageId="working">
      <Marker
        key={label}
        className={cn(
          "animate-in duration-200 ease-out fade-in-0 motion-reduce:animate-none",
          props.background && "min-h-6.5",
        )}
      >
        <MarkerContent
          aria-hidden={!labelled}
          className={cn(
            "shimmer whitespace-nowrap transition-opacity duration-150 motion-reduce:shimmer-none",
            !labelled && "w-0 overflow-hidden opacity-0",
          )}
        >
          {label}
        </MarkerContent>
        {props.background ? (
          <Button
            variant="ghost"
            size="sm"
            aria-label="Press Ctrl+B to move running work to the background"
            inert={!props.background.blocking}
            className={cn(
              "transition-opacity duration-150 motion-reduce:transition-none",
              !props.background.blocking && "opacity-0",
            )}
            onClick={props.background.onMove}
          >
            Move to background
            <KbdGroup className="text-muted-foreground">
              <Kbd>Ctrl</Kbd>
              <Kbd>B</Kbd>
            </KbdGroup>
          </Button>
        ) : null}
      </Marker>
    </MessageScrollerItem>
  )
}

const liveItems = 20

const firstRows = 12

// oxlint-disable-next-line ren/no-comments -- A chat opens with its newest rows, so it shows at once; the rest render in a transition right after, above the fold, where the scroller keeps the view still. Find needs every row.
function useOpening(count: number, options: { readonly all: boolean; readonly at?: number | undefined }) {
  const [opened, setOpened] = useState(false)
  useEffect(() => {
    startTransition(() => setOpened(true))
  }, [])
  if (opened || options.all || options.at === -1) return 0
  return Math.max(0, Math.min(options.at ?? count, count - firstRows))
}

interface Spot {
  readonly row: string
  readonly offset: number
}

// oxlint-disable-next-line ren/no-comments -- Where each chat was left: the rows at the top of the view and how far each sat from the top. A chat left at its end has no place and opens at its end. Rows, not pixels, so the place holds while rows load around it.
const places = new Map<string, ReadonlyArray<Spot> | undefined>()

const placeOf = (viewport: HTMLElement): ReadonlyArray<Spot> | undefined => {
  if (atBottom(viewport)) return undefined
  const top = viewport.getBoundingClientRect().top
  const rows = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].filter((row) => {
    const id = row.dataset.messageId ?? ""
    return id !== "working" && !id.startsWith("live:") && row.getBoundingClientRect().bottom > top + 1
  })
  const spots = rows
    .slice(0, 3)
    .flatMap((row) =>
      row.dataset.messageId ? [{ row: row.dataset.messageId, offset: row.getBoundingClientRect().top - top }] : [],
    )
  return spots.length > 0 ? spots : undefined
}

const rowOf = (blocks: ReadonlyArray<{ readonly key: string }>, place: ReadonlyArray<Spot>) => {
  const found = place.map((spot) => blocks.findIndex((block) => block.key === spot.row)).filter((index) => index >= 0)
  return found.length > 0 ? Math.min(...found) : -1
}

const placeInputs = ["wheel", "touchstart", "keydown", "pointerdown"] as const

const givingUpMs = 3000

const settleMs = 200

// oxlint-disable-next-line ren/no-comments -- Holds the chat where the person is while it does not follow its end: the row at the top stays put as rows load, grow or get replaced above and below it. A chat opened where it was left stays hidden until its row is there, loading older pages for it; it gives up after a few seconds and shows the chat's end.
function useKeptPlace(
  viewport: RefObject<HTMLDivElement | null>,
  place: ReadonlyArray<Spot> | undefined,
  options: {
    readonly session: string
    readonly following: boolean
    readonly more: boolean
    readonly loading: boolean
    readonly onLoadMore: () => void
  },
) {
  const older = useEffectEvent(() => {
    if (options.more && !options.loading) options.onLoadMore()
  })
  const free = useEffectEvent(() => !options.following)
  const session = options.session
  useLayoutEffect(() => {
    const element = viewport.current
    const content = element?.querySelector("[data-slot=message-scroller-content]")
    if (!element || !content) return
    const opening = { place }
    const motion = { moving: false, timer: 0, top: element.scrollTop }
    const still = () => {
      motion.moving = false
    }
    const moved = () => {
      motion.top = element.scrollTop
      motion.moving = true
      window.clearTimeout(motion.timer)
      motion.timer = window.setTimeout(still, settleMs)
    }
    element.addEventListener("scroll", moved, { passive: true })
    element.addEventListener("scrollend", still)
    const reveal = () => element.removeAttribute("data-placing")
    const hold = () => {
      // oxlint-disable-next-line ren/no-comments -- A jump moves the view before its scroll event arrives, and the browser's own anchoring moves it to keep a row still: either way the place is not current, so it waits for the scroll.
      if (!opening.place && Math.abs(element.scrollTop - motion.top) > 1) return moved()
      const spots = opening.place ?? (free() && !motion.moving ? places.get(session) : undefined)
      if (!spots) return
      const rows = [...element.querySelectorAll<HTMLElement>("[data-message-id]")]
      const spot = spots.find((each) => rows.some((row) => row.dataset.messageId === each.row))
      const row = spot && rows.find((each) => each.dataset.messageId === spot.row)
      if (!spot || !row) {
        if (element.hasAttribute("data-placing")) older()
        return
      }
      const delta = row.getBoundingClientRect().top - element.getBoundingClientRect().top - spot.offset
      if (Math.abs(delta) > 0.5) element.scrollTop += delta
      motion.top = element.scrollTop
      reveal()
    }
    if (place) element.setAttribute("data-placing", "")
    hold()
    const observer = new ResizeObserver(hold)
    observer.observe(content)
    observer.observe(element)
    const timer = window.setTimeout(reveal, givingUpMs)
    const settle = () => {
      opening.place = undefined
      window.clearTimeout(timer)
      reveal()
      for (const type of placeInputs) window.removeEventListener(type, settle, { capture: true })
    }
    for (const type of placeInputs) window.addEventListener(type, settle, { capture: true, passive: true })
    return () => {
      settle()
      observer.disconnect()
      window.clearTimeout(motion.timer)
      element.removeEventListener("scroll", moved)
      element.removeEventListener("scrollend", still)
    }
  }, [viewport, place, session])
}

const glideMs = 600

// oxlint-disable-next-line ren/no-comments -- A sent message glides to the top, and only that move eases: a row that lands above it later, such as the model it switched to, must not set the chat sliding again.
function useSendGlide(sent: string | undefined) {
  const [gliding, setGliding] = useState<string>()
  const [seen, setSeen] = useState(sent)
  if (sent !== seen) {
    setSeen(sent)
    setGliding(sent)
  }
  useEffect(() => {
    if (!gliding) return
    const timer = window.setTimeout(() => setGliding(undefined), glideMs)
    return () => window.clearTimeout(timer)
  }, [gliding])
  return gliding ? "" : undefined
}

const freshMs = 2000

// oxlint-disable-next-line ren/no-comments -- Only a message sent in this view anchors the scroller, which brings it to the top, and makes the chat follow again. It must show as it is sent: a message that waited in the queue shows when its turn starts, long after it was sent, and the person may have scrolled away since. The scroller also jumps to any anchor it has not shown yet whenever one row replaces another, so a message from history must never be one.
function useSentAnchor(
  blocks: ReadonlyArray<TranscriptBlocks.Block | LiveSlot | FilesGroup>,
  statuses: ReadonlyMap<string, ChatState.PendingStatus>,
) {
  const users = blocks.filter((block) => block.kind === "user")
  const [opened] = useState(() => new Set(users.map((block) => block.key)))
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set())
  const [fresh, setFresh] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const waiting = [...statuses.keys()].filter((id) => !queued.has(id))
  if (waiting.length > 0) setQueued(new Set([...queued, ...waiting]))
  const last = users.at(-1)
  const sentNow = (message: SessionMessage.User) =>
    !queued.has(message.id) && DateTime.toEpochMillis(message.time.created) > Date.now() - freshMs
  if (last && !opened.has(last.key) && !fresh.has(last.key))
    setFresh(new Map([...fresh, [last.key, sentNow(last.message)]]))
  return last && fresh.get(last.key) === true ? last.key : undefined
}

function useWatchedTurns(running: string | undefined) {
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set())
  if (running && !watched.has(running)) setWatched(new Set([...watched, running]))
  return { live: (turn: string | undefined) => turn !== undefined && (turn === running || watched.has(turn)) }
}

const scrollUpKeys = new Set(["ArrowUp", "PageUp", "Home"])

const bottomSlack = 8

const atBottom = (viewport: HTMLElement) =>
  viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= bottomSlack

// oxlint-disable-next-line ren/no-comments -- Once the person scrolls away from the end, the chat stays where they left it until they send a message or come back to the end; a turn that starts on its own, from the queue or another member, does not pull them down.
function useFollow(options: { readonly paused: boolean }) {
  const [paused, setPaused] = useState(options.paused)
  return {
    following: !paused,
    pause: () => {
      if (!paused) flushSync(() => setPaused(true))
    },
    resume: () => setPaused(false),
  }
}

function contextOf(props: TranscriptProps, byId: ReadonlyMap<string, SessionMessage.Info>): Context {
  return {
    admin: props.admin ?? false,
    handlers: (userMessageID) => {
      const user = byId.get(userMessageID)
      const text = user?.type === "user" ? user.text : undefined
      const tryAgain = props.onTryAgain
      return {
        onTryAgain: tryAgain && text ? () => tryAgain(text) : undefined,
        onContinue: props.onContinue,
        onChangeModel: props.onChangeModel,
        onStop: props.onStop,
      }
    },
    modelNames: props.modelNames ?? new Map(),
    byId,
    turns: Projection.assistantMessagesByParent(props.messages),
    activeMessageID: props.activeMessageID,
  }
}

export function Transcript(props: TranscriptProps) {
  const [place] = useState(() => places.get(props.view.sessionID))
  const follow = useFollow({ paused: place !== undefined })
  const [shown, setShown] = useState(false)
  if (!props.loading && !shown) setShown(true)
  if (props.loading && !shown)
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {props.more && !props.loadingHistory ? <LoadEarlier onVisible={props.onLoadMore} /> : null}
        <MessagesSpinner />
      </div>
    )
  return (
    <ImageSet>
      <StepsProvider
        view={props.view}
        detail={props.detail}
        files={props.files === true}
        onOpenChild={props.onOpenChild}
      >
        <MessageScrollerProvider autoScroll={follow.following && props.find === undefined}>
          <TranscriptScroller transcript={props} follow={follow} place={place} />
        </MessageScrollerProvider>
      </StepsProvider>
    </ImageSet>
  )
}

function FindOverlay(props: { find: FindBarProps; blocks: ReadonlyArray<TranscriptBlocks.Block> }) {
  const match = props.find.match
  const row = props.blocks.find(
    (block) =>
      block.key === match?.row || (block.kind === "steps" && block.steps.some((step) => step.key === match?.row)),
  )?.key
  return (
    <div className="absolute top-2 right-4 z-10">
      <FindBar {...props.find} match={row && match ? { row, occurrence: match.occurrence } : undefined} />
    </div>
  )
}

function TranscriptScroller(input: {
  transcript: TranscriptProps
  follow: ReturnType<typeof useFollow>
  place: ReadonlyArray<Spot> | undefined
}) {
  const props = input.transcript
  const follow = input.follow
  const place = input.place
  const scroller = useMessageScroller()
  const terminal = useTerminalShells(props.view.root)
  const touchY = useRef(0)
  const lastTop = useRef(0)
  const lastHeight = useRef(0)
  const pause = (viewport: HTMLElement) => {
    if ((viewport.querySelector<HTMLElement>("[data-message-scroller-spacer]")?.offsetHeight ?? 0) > 0) return
    follow.pause()
  }
  const toEnd = () => {
    flushSync(follow.resume)
    scroller.scrollToEnd()
  }
  const viewport = useRef<HTMLDivElement>(null)
  useImperativeHandle(props.handle, () => ({
    page: (direction) => {
      const element = viewport.current
      if (!element) return
      if (direction < 0) pause(element)
      element.scrollBy({ top: direction * element.clientHeight * 0.9 })
    },
    toEnd,
  }))
  // oxlint-disable-next-line ren/no-comments -- Commands run in the Terminal tab belong to the terminal. The chat shows no row for them or for their notices, so they never move it.
  const hidden = new Set(props.messages.filter(terminal.message).map((message) => message.id))
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(
    props.messages.filter((message) => !hidden.has(message.id)).map((message) => [message.id, message]),
  )
  const rows = props.rows.filter(
    (row) =>
      !hidden.has(row.userMessageID) && !((row._tag === "Notice" || row._tag === "Shell") && hidden.has(row.messageID)),
  )
  const context = contextOf(props, byId)
  const turns = context.turns
  const activeTurn = props.busy ? props.activeMessageID : undefined
  const watched = useWatchedTurns(activeTurn)
  const blocks = TranscriptBlocks.withEmptyReplies(
    TranscriptBlocks.groupTurns(TranscriptBlocks.blocksOf(rows, byId), {
      live: (turn) => turn === activeTurn,
      fold: props.fold,
    }),
    turns,
    activeTurn,
  )
  const simple = props.simple === true
  const shown = groupFiles(shownBlocks(blocks, { simple, ...liveOf(props, blocks, turns) }))
  const live = props.busy || watched.live(props.activeMessageID)
  const sent = useSentAnchor(shown, props.statuses)
  const easing = useSendGlide(sent)
  const resume = useEffectEvent(() => follow.resume())
  useEffect(() => {
    if (sent) resume()
  }, [sent])
  const from = useOpening(shown.length, {
    all: props.find !== undefined,
    at: place && rowOf(shown, place),
  })
  useKeptPlace(viewport, place, {
    session: props.view.sessionID,
    following: follow.following && props.find === undefined,
    more: props.more,
    loading: props.loadingHistory,
    onLoadMore: props.onLoadMore,
  })
  const [editing, setEditing] = useState<string>()
  const lastAnswer = new Map(
    blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])),
  )
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds === undefined ? undefined : TimelineText.duration(milliseconds)
  }
  // oxlint-disable-next-line ren/no-comments -- A running turn's last answer keeps an empty footer, so the copy button arrives without pushing anything.
  const copyOf = (turn: string, key: string) => {
    if (lastAnswer.get(turn) !== key) return undefined
    return activeTurn === turn ? "" : TimelineText.copyText(turns.get(turn) ?? [])?.text
  }
  const empty =
    props.empty && blocks.length === 0 && !props.busy && !props.more && !props.loadingHistory && !props.loading
  return (
    <MarkdownScroll value={pause}>
      <MessageScroller className="@container flex-1">
        <QuoteSelection quote={props.quote} root={viewport} />
        <MessageScrollerViewport
          ref={viewport}
          data-scroll-restoration-id="transcript"
          preserveScrollOnPrepend
          pinEnd={follow.following && props.find === undefined}
          data-easing={easing}
          className="relative scrollbar-gutter-both data-placing:invisible outline-none not-data-pointer:focus-visible:shadow-[inset_0_0_0_1px_var(--color-border)] data-easing:scroll-smooth motion-reduce:scroll-auto"
          onWheel={(event: WheelEvent<HTMLDivElement>) => {
            if (event.deltaY < 0) pause(event.currentTarget)
            else if (atBottom(event.currentTarget)) toEnd()
          }}
          onTouchStart={(event: TouchEvent<HTMLDivElement>) => {
            touchY.current = event.touches[0]?.clientY ?? 0
          }}
          onTouchMove={(event: TouchEvent<HTMLDivElement>) => {
            if ((event.touches[0]?.clientY ?? 0) > touchY.current) pause(event.currentTarget)
          }}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
            if (scrollUpKeys.has(event.key)) pause(event.currentTarget)
          }}
          onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
            const viewport = event.currentTarget
            viewport.dataset.pointer = ""
            if (event.clientX > viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth)
              pause(event.currentTarget)
          }}
          onBlur={(event: FocusEvent<HTMLDivElement>) => {
            if (!event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.pointer
          }}
          onScroll={(event: UIEvent<HTMLDivElement>) => {
            const viewport = event.currentTarget
            const down = viewport.scrollTop > lastTop.current
            const up = viewport.scrollTop < lastTop.current - 1 && viewport.scrollHeight >= lastHeight.current
            lastTop.current = viewport.scrollTop
            lastHeight.current = viewport.scrollHeight
            if (viewport.hasAttribute("data-placing")) return
            places.set(props.view.sessionID, placeOf(viewport))
            // oxlint-disable-next-line ren/no-comments -- The scroller only ever moves itself down, and a shrink moves the view up with the height: an upward move at the same height is the person's, from the rail or the scrollbar.
            if (up) pause(viewport)
            if (!follow.following && down && atBottom(viewport)) toEnd()
          }}
        >
          {props.more && from === 0 ? <History loading={props.loadingHistory} onLoadMore={props.onLoadMore} /> : null}
          <MessageScrollerContent className="relative mx-auto w-full max-w-(--container-chat) p-6">
            {shown.slice(from).map((block, index) => (
              <MessageScrollerItem
                key={block.key}
                messageId={block.key}
                data-row-key={block.key}
                scrollAnchor={block.key === sent}
                className={cn(
                  block.kind === "user" && "@transcript:-mr-13.5 @transcript:pr-13.5",
                  from + index >= shown.length - liveItems && "[content-visibility:visible]",
                )}
              >
                {block.kind === "files" ? (
                  <Message>
                    <MessageContent>
                      <FileOutputs spaceId={props.spaceId} files={block.files} />
                    </MessageContent>
                  </Message>
                ) : block.kind === "live" ? (
                  <Message>
                    <MessageContent>
                      <TurnLine transcript={props} turns={turns} />
                    </MessageContent>
                  </Message>
                ) : (
                  <BlockView
                    block={block}
                    transcript={props}
                    context={context}
                    editing={editing}
                    onEditing={setEditing}
                    copyOf={copyOf}
                    workedFor={workedFor}
                  />
                )}
              </MessageScrollerItem>
            ))}
            {empty ? (
              <MessageScrollerItem messageId="empty">
                <EmptyState>{props.empty}</EmptyState>
              </MessageScrollerItem>
            ) : null}
            <TurnMarker simple={simple} transcript={props} turns={turns} busy={live} />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {props.find ? <FindOverlay find={props.find} blocks={blocks} /> : null}
        <MessageScrollerButton />
      </MessageScroller>
    </MarkdownScroll>
  )
}

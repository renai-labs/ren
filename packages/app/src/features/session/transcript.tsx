import { DateTime } from "effect"
import { flushSync } from "react-dom"
import {
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
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
  TranscriptBlocks,
  TurnProblems,
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
import { MessagesSpinner } from "../../components/chat-skeleton.js"
import { TranscriptScroll } from "../../lib/transcript-scroll.js"
import { useNow } from "../../lib/use-now.js"
import { LiveActivity, type LiveLine } from "./live-activity.js"
import { useOpenActivity } from "./open-panel.js"
import { EmptyState } from "../../components/empty-state.js"
import { ChannelMark } from "../../components/channel-mark.js"
import { useMentionedApps } from "../../lib/use-app.js"
import { isShellNotice } from "./chat-view.js"
import { ShellNoticeStep, SmoothMarkdown, StepRuns, Steps, StepsProvider } from "./steps.js"
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
  readonly providerNames?: ReadonlyMap<string, string> | undefined
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
  return (
    <TurnProblem
      problem={TurnProblems.of({
        kind: row.kind,
        text: row.text,
        body: row.body,
        assistants: props.context.turns.get(row.userMessageID) ?? [],
        modelNames: props.context.modelNames,
        providerNames: props.context.providerNames,
        admin: props.context.admin,
      })}
      text={row.text}
      handlers={props.context.handlers(row.userMessageID)}
    />
  )
}

function RetryRow(props: { row: Extract<TimelineRow.Row, { _tag: "Retry" }>; context: Context }) {
  const row = props.row
  if (props.context.activeMessageID !== row.userMessageID) return null
  const retrying = TurnProblems.retrying(props.context.turns.get(row.userMessageID) ?? [], props.context.providerNames)
  if (!retrying) return null
  return <TurnRetrying retrying={retrying} handlers={props.context.handlers(row.userMessageID)} />
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
  if (isShellNotice(message))
    return (
      <Message>
        <MessageContent>
          <ShellNoticeStep message={message} />
        </MessageContent>
      </Message>
    )
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
  readonly handlers: (userMessageID: string) => TurnProblems.Handlers
  readonly modelNames: ReadonlyMap<string, string>
  readonly providerNames: ReadonlyMap<string, string>
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
  block: TranscriptBlocks.Block | LiveSlot | FilesGroup
  transcript: TranscriptProps
  context: Context
  editing: string | undefined
  onEditing: (id: string | undefined) => void
  copyOf: (turn: string, key: string) => string | undefined
  workedFor: (turn: string) => string | undefined
}) {
  const block = props.block
  if (block.kind === "files")
    return (
      <Message>
        <MessageContent>
          <FileOutputs spaceId={props.transcript.spaceId} files={block.files} />
        </MessageContent>
      </Message>
    )
  if (block.kind === "live")
    return (
      <Message>
        <MessageContent>
          <TurnLine transcript={props.transcript} turns={props.context.turns} />
        </MessageContent>
      </Message>
    )
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

const freshMs = 2000

function useSentAnchor(
  blocks: ReadonlyArray<TranscriptBlocks.Block | LiveSlot | FilesGroup>,
  statuses: ReadonlyMap<string, ChatState.PendingStatus>,
) {
  const users = blocks.filter((block) => block.kind === "user")
  const now = useNow()
  const [queued, setQueued] = useState<ReadonlySet<string>>(() => new Set())
  const [fresh, setFresh] = useState<ReadonlyMap<string, boolean>>(
    () => new Map(users.map((block) => [block.key, false])),
  )
  const waiting = [...statuses.keys()].filter((id) => !queued.has(id))
  if (waiting.length > 0) setQueued(new Set([...queued, ...waiting]))
  const last = users.at(-1)
  if (last && !fresh.has(last.key))
    setFresh(
      new Map([
        ...fresh,
        [last.key, !queued.has(last.message.id) && DateTime.toEpochMillis(last.message.time.created) > now - freshMs],
      ]),
    )
  return last && fresh.get(last.key) === true ? last.key : undefined
}

function useWatchedTurns(running: string | undefined) {
  const [watched, setWatched] = useState<ReadonlySet<string>>(() => new Set())
  if (running && !watched.has(running)) setWatched(new Set([...watched, running]))
  return { live: (turn: string | undefined) => turn !== undefined && (turn === running || watched.has(turn)) }
}

const scrollUpKeys = new Set(["ArrowUp", "PageUp", "Home"])

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
    providerNames: props.providerNames ?? new Map(),
    byId,
    turns: Projection.assistantMessagesByParent(props.messages),
    activeMessageID: props.activeMessageID,
  }
}

export function Transcript(props: TranscriptProps) {
  const session = props.view.sessionID
  const [opening, setOpening] = useState(() => ({ session, place: TranscriptScroll.placeOf(session) }))
  if (opening.session !== session) setOpening({ session, place: TranscriptScroll.placeOf(session) })
  const place = opening.place
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
  place: ReadonlyArray<TranscriptScroll.Spot> | undefined
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
  const hidden = new Set<string>(props.messages.filter(terminal.message).map((message) => message.id))
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
  const easing = TranscriptScroll.useSendGlide(sent)
  TranscriptScroll.useOnSent(sent, follow.resume)
  const pinned = follow.following && props.find === undefined
  const from = TranscriptScroll.useOpening(shown, { all: props.find !== undefined, place })
  TranscriptScroll.useKeptPlace(viewport, place, {
    session: props.view.sessionID,
    following: pinned,
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
  const copyOf = (turn: string, key: string) => {
    if (lastAnswer.get(turn) !== key) return
    return activeTurn === turn ? "" : TimelineText.copyText(turns.get(turn) ?? [])?.text
  }
  const pending = [props.busy, props.more, props.loadingHistory, props.loading].some(Boolean)
  const empty = props.empty && blocks.length === 0 && !pending
  return (
    <MarkdownScroll value={pause}>
      <MessageScroller className="@container flex-1">
        <QuoteSelection quote={props.quote} root={viewport} />
        <MessageScrollerViewport
          ref={viewport}
          data-scroll-restoration-id="transcript"
          preserveScrollOnPrepend
          pinEnd={pinned}
          data-easing={easing}
          className="relative scrollbar-gutter-both outline-none not-data-pointer:focus-visible:shadow-[inset_0_0_0_1px_var(--color-border)] data-easing:scroll-smooth data-placing:invisible motion-reduce:scroll-auto"
          onWheel={(event: WheelEvent<HTMLDivElement>) => {
            if (event.deltaY < 0) pause(event.currentTarget)
            else if (TranscriptScroll.atBottom(event.currentTarget)) toEnd()
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
            TranscriptScroll.keepPlace(props.view.sessionID, viewport)
            if (up) pause(viewport)
            if (!follow.following && down && TranscriptScroll.atBottom(viewport)) toEnd()
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
                <BlockView
                  block={block}
                  transcript={props}
                  context={context}
                  editing={editing}
                  onEditing={setEditing}
                  copyOf={copyOf}
                  workedFor={workedFor}
                />
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

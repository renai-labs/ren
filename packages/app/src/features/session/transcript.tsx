import { DateTime } from "effect"
import { flushSync } from "react-dom"
import {
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  type TouchEvent,
  type UIEvent,
  type WheelEvent,
} from "react"
import {
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
import { DriveFileCards } from "./attachments.js"
import { QuoteSelection, type QuoteProps } from "./quote.js"
import { Markdown } from "../../components/markdown.js"
import { MarkdownScroll } from "../../components/markdown-link.js"
import { ImageSet } from "../../components/image-set.js"
import { TurnProblem, TurnRetrying } from "./turn-problem.js"
import { providerLabel, type ProblemHandlers } from "./turn-problems.js"
import { MessagesSkeleton } from "../../components/chat-skeleton.js"
import { EmptyState } from "../../components/empty-state.js"
import { ChannelMark } from "../../components/channel-mark.js"
import { useMentionedApps } from "../../lib/use-app.js"
import { SmoothMarkdown, StepRuns, Steps, StepsProvider } from "./steps.js"
import { TranscriptBlocks } from "./transcript-blocks.js"
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
        {props.copy ? (
          <MessageFooter>
            <CopyButton text={props.copy} />
          </MessageFooter>
        ) : null}
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
  activeTurn: string | undefined
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
      <Message>
        <MessageContent>
          {props.transcript.fold ? (
            <Steps
              steps={block.steps}
              running={props.activeTurn === block.turn}
              workedFor={props.workedFor(block.turn)}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <StepRuns steps={block.steps} />
            </div>
          )}
        </MessageContent>
      </Message>
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
          <DriveFileCards spaceId={props.transcript.spaceId} files={[block.file]} />
        </MessageContent>
      </Message>
    )
  return <SystemRow row={block.row} context={props.context} />
}

function History(props: { loading: boolean; onLoadMore: () => void }) {
  return (
    <div className="absolute inset-x-0 top-0 flex h-6 items-center justify-center text-xs text-muted-foreground">
      {props.loading ? (
        <output className="flex items-center gap-2">
          <Spinner />
          Loading earlier messages
        </output>
      ) : (
        <LoadEarlier onVisible={props.onLoadMore} />
      )}
    </div>
  )
}

function WorkingMarker(props: { busy: boolean; working: boolean; background: TranscriptProps["background"] }) {
  if (!props.busy && !props.working) return null
  const labelled = props.working || props.background?.blocking === true
  return (
    // ast-grep-ignore: require-message-scroller-parts -- rendered only inside the transcript's MessageScrollerContent
    <MessageScrollerItem messageId="working">
      <Marker className={cn(props.background && "min-h-6.5")}>
        <MarkerContent
          aria-hidden={!labelled}
          className={cn(
            "shimmer whitespace-nowrap transition-opacity duration-150 motion-reduce:shimmer-none",
            !labelled && "w-0 overflow-hidden opacity-0",
          )}
        >
          Working on the next step
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

function useEasedSend(blocks: ReadonlyArray<TranscriptBlocks.Block>) {
  const sent = blocks.filter((block) => block.kind === "user").length
  const [opened, setOpened] = useState(sent)
  if (sent < opened) setOpened(sent)
  return sent > opened && blocks.at(-1)?.kind === "user" ? "" : undefined
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

function useFollow(turn: string | undefined) {
  const [paused, setPaused] = useState<{ readonly turn: string | undefined }>()
  const following = paused === undefined || paused.turn !== turn
  return {
    following,
    pause: () => {
      if (following) flushSync(() => setPaused({ turn }))
    },
    resume: () => setPaused(undefined),
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
  const follow = useFollow(props.activeMessageID)
  if (props.loading)
    return (
      <div className="min-h-0 flex-1 overflow-hidden">
        {props.more && !props.loadingHistory ? <LoadEarlier onVisible={props.onLoadMore} /> : null}
        <div className="mx-auto w-full max-w-(--container-chat) p-6">
          <MessagesSkeleton />
        </div>
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
          <TranscriptScroller transcript={props} follow={follow} />
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

function TranscriptScroller(input: { transcript: TranscriptProps; follow: ReturnType<typeof useFollow> }) {
  const props = input.transcript
  const follow = input.follow
  const scroller = useMessageScroller()
  const touchY = useRef(0)
  const lastTop = useRef(0)
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
  const byId: ReadonlyMap<string, SessionMessage.Info> = new Map(props.messages.map((message) => [message.id, message]))
  const context = contextOf(props, byId)
  const turns = context.turns
  const activeTurn = props.busy ? props.activeMessageID : undefined
  const watched = useWatchedTurns(activeTurn)
  const blocks = TranscriptBlocks.withEmptyReplies(
    TranscriptBlocks.groupTurns(TranscriptBlocks.blocksOf(props.rows, byId), { live: watched.live, fold: props.fold }),
    turns,
    activeTurn,
  )
  const easing = useEasedSend(blocks)
  const [editing, setEditing] = useState<string>()
  const lastAnswer = new Map(
    blocks.flatMap((block) => (block.kind === "answer" ? [[block.turn, block.key] as const] : [])),
  )
  const workedFor = (turn: string) => {
    const user = byId.get(turn)
    const milliseconds = TimelineText.turnDuration(user?.type === "user" ? user : undefined, turns.get(turn) ?? [])
    return milliseconds === undefined ? undefined : TimelineText.duration(milliseconds)
  }
  const copyOf = (turn: string, key: string) =>
    lastAnswer.get(turn) === key && activeTurn !== turn ? TimelineText.copyText(turns.get(turn) ?? [])?.text : undefined
  const empty =
    props.empty && blocks.length === 0 && !props.busy && !props.more && !props.loadingHistory && !props.loading
  return (
    <MarkdownScroll value={pause}>
      <MessageScroller className="@container flex-1">
        <QuoteSelection quote={props.quote} root={viewport} />
        <MessageScrollerViewport
          ref={viewport}
          preserveScrollOnPrepend
          pinEnd={follow.following && props.find === undefined}
          data-easing={easing}
          className="relative scrollbar-gutter-both outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--color-border)] data-easing:scroll-smooth motion-reduce:scroll-auto"
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
            if (event.clientX > viewport.getBoundingClientRect().left + viewport.clientLeft + viewport.clientWidth)
              pause(event.currentTarget)
          }}
          onScroll={(event: UIEvent<HTMLDivElement>) => {
            const viewport = event.currentTarget
            const down = viewport.scrollTop > lastTop.current
            lastTop.current = viewport.scrollTop
            if (!follow.following && down && atBottom(viewport)) toEnd()
          }}
        >
          {props.more ? <History loading={props.loadingHistory} onLoadMore={props.onLoadMore} /> : null}
          <MessageScrollerContent className="relative mx-auto w-full max-w-(--container-chat) p-6">
            {blocks.map((block, index) => (
              <MessageScrollerItem
                key={block.key}
                messageId={block.key}
                data-row-key={block.key}
                scrollAnchor={block.kind === "user"}
                className={cn(
                  block.kind === "user" && "@transcript:-mr-13.5 @transcript:pr-13.5",
                  index >= blocks.length - liveItems && "[content-visibility:visible]",
                )}
              >
                <BlockView
                  block={block}
                  transcript={props}
                  context={context}
                  editing={editing}
                  onEditing={setEditing}
                  activeTurn={activeTurn}
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
            <WorkingMarker
              busy={props.busy || watched.live(props.activeMessageID)}
              working={props.working}
              background={props.background}
            />
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {props.find ? <FindOverlay find={props.find} blocks={blocks} /> : null}
        <MessageScrollerButton />
      </MessageScroller>
    </MarkdownScroll>
  )
}

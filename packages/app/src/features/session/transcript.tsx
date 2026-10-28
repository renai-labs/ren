import { type ChatState, Projection, type TimelineDetail, TimelineRow, TimelineText } from "@ren/chat"
import type { ChatAtoms } from "@ren/chat"
import type { Session } from "@ren/schema/session"
import type { SessionMessage } from "@ren/schema/session/message"
import type { SessionModel } from "@ren/schema/session/model"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerViewport,
  useMessageScroller,
} from "@ren/ui/message-scroller"
import { Spinner } from "@ren/ui/spinner"
import { DateTime, Match } from "effect"
// oxlint-disable-next-line no-restricted-imports -- the React Compiler memoizes inside a component, not across the items of a list, so memo keeps a streaming reply from re-rendering every row
import { memo } from "react"
import {
  type PendingAction,
  type Person,
  type RowData,
  type Shared,
  TranscriptRow,
  TurnGroup,
  Working,
} from "./session-transcript.js"
import { FilesReset } from "./transcript-notice.js"
import { TranscriptTurn } from "./transcript-turn.js"
import { Timeline } from "./timeline.js"

const none: ReadonlySet<string> = new Set()

const nobody: ReadonlyMap<string, Person> = new Map()

const unnamed: ReadonlyMap<string, string> = new Map()

const member: Person = { name: "Member", image: undefined }

const responseMeta = (turn: SessionMessage.Info | undefined, assistants: ReadonlyArray<SessionMessage.Assistant>) => {
  const duration = TimelineText.duration(
    TimelineText.turnDuration(turn?.type === "user" ? turn : undefined, assistants) ?? -1,
  )
  const interrupted = Projection.isInterrupted(assistants.at(-1)?.error)
  return [duration, interrupted ? "Interrupted" : undefined].filter(Boolean).join(" · ")
}

const sameValue = (left: unknown, right: unknown) =>
  left === right ||
  (Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index]))

const fieldsOf = (data: RowData): ReadonlyArray<unknown> => [
  data.message,
  data.messages,
  data.status,
  data.caption,
  data.sender,
  data.senderImage,
  data.updating,
  data.working,
  data.copy,
  data.meta,
  data.retry?.attempt,
  data.retry?.message,
  data.retry?.next,
]

const sameData = (left: RowData, right: RowData) => {
  const next = fieldsOf(right)
  return fieldsOf(left).every((value, index) => sameValue(value, next[index]))
}

const sameShared = (left: Shared, right: Shared) =>
  left === right ||
  (left.root === right.root &&
    left.sessionID === right.sessionID &&
    left.part === right.part &&
    left.reverting === right.reverting &&
    left.detail === right.detail &&
    left.onRevert === right.onRevert &&
    left.onEdit === right.onEdit &&
    left.onPending === right.onPending &&
    left.onOpenChild === right.onOpenChild &&
    left.onOpenSession === right.onOpenSession)

interface RowProps {
  readonly row: TimelineRow.Row
  readonly data: RowData
  readonly shared: Shared
  readonly reset: boolean
}

function RowView(props: RowProps) {
  return (
    <>
      {props.reset ? <FilesReset /> : null}
      <TranscriptRow shared={props.shared} data={props.data} row={props.row} />
    </>
  )
}

interface GroupProps {
  readonly rows: ReadonlyArray<{ readonly key: string; readonly row: TimelineRow.Row; readonly data: RowData }>
  readonly shared: Shared
  readonly running: boolean
  readonly workedFor: string | undefined
  readonly steps: number
  readonly revealed: boolean
}

const Group = memo(
  TurnGroup,
  (previous: GroupProps, next: GroupProps) =>
    sameShared(previous.shared, next.shared) &&
    previous.running === next.running &&
    previous.workedFor === next.workedFor &&
    previous.steps === next.steps &&
    previous.revealed === next.revealed &&
    previous.rows.length === next.rows.length &&
    previous.rows.every((item, index) => {
      const other = next.rows[index]
      return other !== undefined && item.row === other.row && sameData(item.data, other.data)
    }),
)

const Row = memo(
  RowView,
  (previous, next) =>
    previous.row === next.row &&
    sameShared(previous.shared, next.shared) &&
    previous.reset === next.reset &&
    sameData(previous.data, next.data),
)

function Reveal(props: { item: string }) {
  const scroller = useMessageScroller()
  return (
    <span
      hidden
      ref={(node) => {
        if (node) scroller.scrollToMessage(props.item, { align: "start" })
      }}
    />
  )
}

function LoadEarlier(props: { onVisible: () => void }) {
  return (
    <div
      aria-hidden
      className="h-px shrink-0"
      ref={(node) => {
        if (!node) return
        const observer = new IntersectionObserver((found) => {
          if (found.some((entry) => entry.isIntersecting)) props.onVisible()
        })
        observer.observe(node)
        return () => observer.disconnect()
      }}
    />
  )
}

function rowData(input: {
  messages: ReadonlyMap<string, SessionMessage.Info>
  turns: TranscriptTurn.Turns
  rows: ReadonlyArray<TimelineRow.Row>
  all: ReadonlyArray<SessionMessage.Info>
  statuses: ReadonlyMap<string, ChatState.PendingStatus>
  viewer: string | undefined
  people: ReadonlyMap<string, Person>
  modelNames: ReadonlyMap<string, string>
  updating: ReadonlySet<string>
}) {
  const messages = input.messages
  const turns = input.turns
  const lastGroups = Projection.indexes(input.rows).lastAssistantGroupKey
  const contexts: ReadonlyMap<string, { readonly model: SessionModel.Ref }> = Projection.userContext(input.all)
  const empty = (): RowData => ({})
  return Match.typeTags<TimelineRow.Row, RowData>()({
    UserMessage: (row) => {
      const message = messages.get(row.userMessageID)
      const context = contexts.get(row.userMessageID)
      const status = input.statuses.get(row.userMessageID)
      const senderID = message?.type === "user" ? message.sender?.userId : undefined
      const sender = senderID && senderID !== input.viewer ? (input.people.get(senderID) ?? member) : undefined
      return {
        message,
        status,
        caption: [
          status === "steering" || status === "stranded" ? "Pending" : undefined,
          context ? TimelineText.modelLabel(context.model, input.modelNames) : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
        sender: sender?.name,
        senderImage: sender?.image,
        updating: input.updating.has(row.userMessageID),
      }
    },
    AssistantPart: (row) => {
      const group = row.group
      const working = TranscriptTurn.working(turns, row.userMessageID)
      if (group.type !== "part")
        return {
          messages: group.refs.map((reference) => messages.get(reference.messageID)),
          working: working && lastGroups.get(row.userMessageID) === group.key,
        }
      const assistants = turns.turns.get(row.userMessageID) ?? []
      const copy = TimelineText.copyText(assistants)
      const copyable = copy?.partID === group.ref.partID && !working
      return {
        message: messages.get(group.ref.messageID),
        copy: copyable ? copy.text : undefined,
        meta: copyable ? responseMeta(messages.get(row.userMessageID), assistants) : undefined,
      }
    },
    Notice: (row) => ({ message: messages.get(row.messageID) }),
    Shell: (row) => ({ message: messages.get(row.messageID) }),
    Thinking: (row) => ({ message: messages.get(row.ref.messageID) }),
    Retry: (row) => ({
      retry:
        turns.activeMessageID === row.userMessageID
          ? TimelineText.retryStatus(turns.turns.get(row.userMessageID) ?? [])
          : undefined,
    }),
    Error: empty,
    TurnDivider: empty,
    CompactionQueued: empty,
    TurnGap: empty,
  })
}

const keysOf = (rows: ReadonlyArray<TimelineRow.Row>) => rows.map((row) => TimelineRow.key(row))

const revealedOf = (blocks: ReadonlyArray<TranscriptTurn.Block>, target: string | undefined) =>
  target === undefined
    ? undefined
    : blocks.find((block) => (block.kind === "turn" ? keysOf(block.rows).includes(target) : block.key === target))?.key

const busyOf = (rows: ReadonlyArray<TimelineRow.Row>, turns: TranscriptTurn.Turns) =>
  rows.some((row) => TranscriptTurn.rowBusy(turns, row))

const anchorOf = (row: TimelineRow.Row) => {
  const message = Timeline.messageIDs(row).at(0)
  return row._tag === "UserMessage" && message ? { id: `message-${message}` } : {}
}

const turnOf = (
  block: Extract<TranscriptTurn.Block, { kind: "turn" }>,
  context: { readonly messages: ReadonlyMap<string, SessionMessage.Info>; readonly turns: TranscriptTurn.Turns },
) => {
  const user = context.messages.get(block.turn)
  const duration = TimelineText.turnDuration(
    user?.type === "user" ? user : undefined,
    context.turns.turns.get(block.turn) ?? [],
  )
  return {
    running: context.turns.busy && context.turns.activeMessageID === block.turn,
    workedFor: duration === undefined ? undefined : TimelineText.duration(duration),
    steps: block.rows.reduce((total, row) => total + TranscriptTurn.steps(row, context.messages), 0),
  }
}

// oxlint-disable-next-line ren/no-comments -- The chat moved to a new machine at filesResetAt: the notice goes before the first message after that time, or at the end (E117). It waits for the chat's rows, so the list never starts with the footer alone.
const resetOf = (
  rows: ReadonlyArray<TimelineRow.Row>,
  messages: ReadonlyMap<string, SessionMessage.Info>,
  filesResetAt: DateTime.Utc | null | undefined,
) => {
  const at = rows.length > 0 ? filesResetAt : undefined
  if (!at) return { at: undefined, before: undefined }
  return {
    at,
    before: rows.find((row) => {
      const message = row._tag === "UserMessage" ? messages.get(row.userMessageID) : undefined
      return message !== undefined && DateTime.isGreaterThanOrEqualTo(message.time.created, at)
    }),
  }
}

export interface History {
  readonly more: boolean
  readonly loading: boolean
  readonly onLoadOlder: () => void
}

export function Transcript(props: {
  label: string
  view: ChatAtoms.View
  statuses: ReadonlyMap<string, ChatState.PendingStatus>
  messages: ReadonlyArray<SessionMessage.Info>
  rows: ReadonlyArray<TimelineRow.Row>
  activeMessageID: string | undefined
  busy: boolean
  working: boolean
  history: History
  target?: string | undefined
  modelNames?: ReadonlyMap<string, string>
  part?: string | undefined
  reverting?: boolean
  updating?: ReadonlySet<string>
  onRevert?: ((message: SessionMessage.User) => void) | undefined
  onEdit?: ((message: SessionMessage.User, text: string) => void) | undefined
  onPending?: (action: PendingAction, message: SessionMessage.User) => void
  onOpenChild: (sessionID: Session.ID) => void
  onOpenSession?: (sessionID: string) => void
  onFollow?: () => void
  detail?: TimelineDetail.Detail | undefined
  viewer?: string
  people?: ReadonlyMap<string, Person>
  filesResetAt?: DateTime.Utc | null
}) {
  const messages: ReadonlyMap<string, SessionMessage.Info> = new Map(
    props.messages.map((message) => [message.id, message]),
  )
  const turns: TranscriptTurn.Turns = {
    turns: Projection.assistantMessagesByParent(props.messages),
    activeMessageID: props.activeMessageID,
    busy: props.busy,
  }
  const shared: Shared = {
    root: props.view.root,
    sessionID: props.view.sessionID,
    part: props.part,
    reverting: props.reverting === true,
    detail: props.detail,
    onRevert: props.onRevert,
    onEdit: props.onEdit,
    onPending: props.onPending,
    onOpenChild: props.onOpenChild,
    onOpenSession: props.onOpenSession,
  }
  const data = rowData({
    messages,
    turns,
    rows: props.rows,
    all: props.messages,
    statuses: props.statuses,
    viewer: props.viewer,
    people: props.people ?? nobody,
    modelNames: props.modelNames ?? unnamed,
    updating: props.updating ?? none,
  })
  const reset = resetOf(props.rows, messages, props.filesResetAt)
  const history = props.history
  const target = props.target
  const blocks = TranscriptTurn.blocks(
    props.rows.filter((row) => row._tag !== "TurnGap"),
    messages,
  )
  const revealed = revealedOf(blocks, target)
  const groupOf = (block: Extract<TranscriptTurn.Block, { kind: "turn" }>) => ({
    ...turnOf(block, { messages, turns }),
    rows: block.rows.map((row) => ({ key: TimelineRow.key(row), row, data: data(row) })),
    shared,
    revealed: block.key === revealed,
  })
  return (
    <MessageScroller data-slot="transcript" className="flex-1">
      <MessageScrollerViewport aria-label={props.label} preserveScrollOnPrepend className="scrollbar-gutter-both">
        {history.more && !history.loading ? <LoadEarlier onVisible={history.onLoadOlder} /> : null}
        <MessageScrollerContent className="mx-auto w-full max-w-192 px-4 pt-6 pb-8 md:px-6">
          {blocks.map((block) =>
            block.kind === "turn" ? (
              <MessageScrollerItem
                key={block.key}
                messageId={block.key}
                aria-busy={busyOf(block.rows, turns) || undefined}
              >
                <Group {...groupOf(block)} />
              </MessageScrollerItem>
            ) : (
              <MessageScrollerItem
                key={block.key}
                messageId={block.key}
                scrollAnchor={block.row._tag === "UserMessage"}
                data-row-key={block.key}
                aria-busy={busyOf([block.row], turns) || undefined}
                {...anchorOf(block.row)}
                className="flex flex-col gap-6 empty:hidden"
              >
                <Row row={block.row} data={data(block.row)} shared={shared} reset={block.row === reset.before} />
              </MessageScrollerItem>
            ),
          )}
          {reset.at && !reset.before ? (
            <MessageScrollerItem messageId="files-reset">
              <FilesReset />
            </MessageScrollerItem>
          ) : null}
          {props.working ? (
            <MessageScrollerItem messageId="working">
              <Working label="Working on the next step" />
            </MessageScrollerItem>
          ) : null}
        </MessageScrollerContent>
      </MessageScrollerViewport>
      {history.loading ? (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
          <Spinner aria-label="Loading earlier messages" className="size-5 text-muted-foreground" />
        </div>
      ) : null}
      {revealed ? <Reveal key={target} item={revealed} /> : null}
      <MessageScrollerButton onClick={() => props.onFollow?.()} />
    </MessageScroller>
  )
}

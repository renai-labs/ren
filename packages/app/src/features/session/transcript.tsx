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
import type { AppMention } from "@ren/ui/app-mention"
import { DateTime, Match } from "effect"
// oxlint-disable-next-line no-restricted-imports -- the React Compiler memoizes inside a component, not across the items of a list, so memo keeps a streaming reply from re-rendering every row
import { memo } from "react"
import { type Person, type RowData, TranscriptRow, TurnGroup } from "./session-transcript.js"
import { type PendingAction, TranscriptContext } from "./transcript-context.js"
import { FilesReset, Working } from "./transcript-notice.js"
import { TranscriptTurn } from "./transcript-turn.js"

const none: ReadonlySet<string> = new Set()

const nobody: ReadonlyMap<string, Person> = new Map()

const noApps: ReadonlyArray<AppMention.App> = []

const unnamed: ReadonlyMap<string, string> = new Map()

const member: Person = { name: "Member", image: undefined }

// oxlint-disable-next-line ren/no-comments -- Row props are rebuilt on every update, so memo compares them by value down to `depth` levels and by identity below that.
const same = (left: unknown, right: unknown, depth: number): boolean => {
  if (Object.is(left, right)) return true
  if (depth === 0 || typeof left !== "object" || typeof right !== "object" || left === null || right === null)
    return false
  const before = new Map(Object.entries(left))
  const entries = Object.entries(right)
  return before.size === entries.length && entries.every((entry) => same(before.get(entry[0]), entry[1], depth - 1))
}

const Group = memo(TurnGroup, (previous, next) => same(previous, next, 5))

function RowView(props: { row: TimelineRow.Row; data: RowData; reset: boolean }) {
  return (
    <>
      {props.reset ? <FilesReset /> : null}
      <TranscriptRow data={props.data} row={props.row} />
    </>
  )
}

const Row = memo(RowView, (previous, next) => same(previous, next, 3))

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

const userOf = (messages: ReadonlyMap<string, SessionMessage.Info>, id: string) => {
  const message = messages.get(id)
  return message?.type === "user" ? message : undefined
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
  const lastGroups = Projection.indexes(input.rows).lastAssistantGroupKey
  const contexts: ReadonlyMap<string, { readonly model: SessionModel.Ref }> = Projection.userContext(input.all)
  const part = (message: SessionMessage.Info | undefined, partID: string): RowData => ({
    content: Projection.resolveContent(message, partID),
    streaming: message?.type === "assistant" && !message.time.completed,
  })
  const empty = (): RowData => ({})
  return Match.typeTags<TimelineRow.Row, RowData>()({
    UserMessage: (row) => {
      const message = input.messages.get(row.userMessageID)
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
      const working = TranscriptTurn.working(input.turns, row.userMessageID)
      if (group.type !== "part")
        return {
          messages: group.refs.map((reference) => input.messages.get(reference.messageID)),
          working: working && lastGroups.get(row.userMessageID) === group.key,
        }
      const assistants = input.turns.turns.get(row.userMessageID) ?? []
      const copy = TimelineText.copyText(assistants)
      const copyable = copy?.partID === group.ref.partID && !working
      return {
        ...part(input.messages.get(group.ref.messageID), group.ref.partID),
        copy: copyable ? copy.text : undefined,
        meta: copyable
          ? [
              TimelineText.duration(
                TimelineText.turnDuration(userOf(input.messages, row.userMessageID), assistants) ?? -1,
              ),
              Projection.isInterrupted(assistants.at(-1)?.error) ? "Interrupted" : undefined,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined,
      }
    },
    Notice: (row) => ({ message: input.messages.get(row.messageID) }),
    Shell: (row) => ({ message: input.messages.get(row.messageID) }),
    Thinking: (row) => part(input.messages.get(row.ref.messageID), row.ref.partID),
    Retry: (row) => ({
      retry:
        input.turns.activeMessageID === row.userMessageID
          ? TimelineText.retryStatus(input.turns.turns.get(row.userMessageID) ?? [])
          : undefined,
    }),
    Error: empty,
    TurnDivider: empty,
    CompactionQueued: empty,
    TurnGap: empty,
  })
}

const busyOf = (rows: ReadonlyArray<TimelineRow.Row>, turns: TranscriptTurn.Turns) =>
  rows.some((row) => TranscriptTurn.rowBusy(turns, row))

const revealedOf = (blocks: ReadonlyArray<TranscriptTurn.Block>, target: string | undefined) =>
  target === undefined
    ? undefined
    : blocks.find((block) =>
        block.kind === "turn" ? block.rows.some((row) => TimelineRow.key(row) === target) : block.key === target,
      )?.key

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
  apps?: ReadonlyArray<AppMention.App>
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
  const blocks = TranscriptTurn.blocks(
    props.rows.filter((row) => row._tag !== "TurnGap"),
    messages,
  )
  const revealed = revealedOf(blocks, props.target)
  return (
    <TranscriptContext.Context
      value={{
        state: {
          root: props.view.root,
          sessionID: props.view.sessionID,
          part: props.part,
          reverting: props.reverting === true,
          detail: props.detail,
          apps: props.apps ?? noApps,
        },
        actions: {
          onRevert: props.onRevert,
          onEdit: props.onEdit,
          onPending: props.onPending,
          onOpenChild: props.onOpenChild,
          onOpenSession: props.onOpenSession,
        },
      }}
    >
      <MessageScroller data-slot="transcript" className="flex-1">
        <MessageScrollerViewport aria-label={props.label} preserveScrollOnPrepend className="scrollbar-gutter-both">
          {history.more && !history.loading ? <LoadEarlier onVisible={history.onLoadOlder} /> : null}
          <MessageScrollerContent className="mx-auto w-full max-w-192 px-4 pt-6 pb-8 md:px-6">
            {blocks.map((block) => {
              if (block.kind === "row")
                return (
                  <MessageScrollerItem
                    key={block.key}
                    messageId={block.key}
                    scrollAnchor={block.row._tag === "UserMessage"}
                    data-row-key={block.key}
                    aria-busy={busyOf([block.row], turns) || undefined}
                    className="flex flex-col gap-6 empty:hidden"
                  >
                    <Row row={block.row} data={data(block.row)} reset={block.row === reset.before} />
                  </MessageScrollerItem>
                )
              const duration = TimelineText.turnDuration(
                userOf(messages, block.turn),
                turns.turns.get(block.turn) ?? [],
              )
              return (
                <MessageScrollerItem
                  key={block.key}
                  messageId={block.key}
                  aria-busy={busyOf(block.rows, turns) || undefined}
                >
                  <Group
                    rows={block.rows.map((row) => ({ row, data: data(row) }))}
                    running={turns.busy && turns.activeMessageID === block.turn}
                    workedFor={duration === undefined ? undefined : TimelineText.duration(duration)}
                    steps={block.rows.reduce((total, row) => total + TranscriptTurn.steps(row, messages), 0)}
                    revealed={block.key === revealed}
                  />
                </MessageScrollerItem>
              )
            })}
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
        {revealed ? <Reveal key={props.target} item={revealed} /> : null}
        <MessageScrollerButton onClick={() => props.onFollow?.()} />
      </MessageScroller>
    </TranscriptContext.Context>
  )
}
